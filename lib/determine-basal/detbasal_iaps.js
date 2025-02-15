/*
  Determine Basal
  Released under MIT license. See the accompanying LICENSE.txt file for
  full terms and conditions
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
  THE SOFTWARE.
*/

// Define various functions used later on, in the main function determine_basal() below

var round_basal = require('../round-basal');

// Rounds value to 'digits' decimal places
function round(value, digits) {
    if (! digits) { digits = 0; }
    var scale = Math.pow(10, digits);
    return Math.round(value * scale) / scale;
}

// we expect BG to rise or fall at the rate of BGI,
// adjusted by the rate at which BG would need to rise /
// fall to get eventualBG to target over 2 hours
function calculate_expected_delta(target_bg, eventual_bg, bgi) {
    // (hours * mins_per_hour) / 5 = how many 5 minute periods in 2h = 24
    var five_min_blocks = (2 * 60) / 5;
    var target_delta = target_bg - eventual_bg;
    return /* expectedDelta */ round(bgi + (target_delta / five_min_blocks), 1);
}


function convert_bg(value, profile)
{
    if (profile.out_units === "mmol/L")
    {
        return round(value * 0.0555,1);
    }
    else
    {
        return Math.round(value);
    }
}
function enable_smb(
    profile,
    microBolusAllowed,
    meal_data,
    bg,
    target_bg,
    high_bg
) {
    // disable SMB when a high temptarget is set
    if (! microBolusAllowed) {
        console.error("SMB disabled (!microBolusAllowed)");
        return false;
    } else if (! profile.allowSMB_with_high_temptarget && profile.temptargetSet && target_bg > 100) {
        console.error("SMB disabled due to high temptarget of " + target_bg);
        return false;
    } else if (meal_data.bwFound === true && profile.A52_risk_enable === false) {
        console.error("SMB disabled due to Bolus Wizard activity in the last 6 hours.");
        return false;
    }

    // enable SMB/UAM if always-on (unless previously disabled for high temptarget)
    if (profile.enableSMB_always === true) {
        if (meal_data.bwFound) {
            console.error("Warning: SMB enabled within 6h of using Bolus Wizard: be sure to easy bolus 30s before using Bolus Wizard");
        } else {
            console.error("SMB enabled due to enableSMB_always");
        }
        return true;
    }

    // enable SMB/UAM (if enabled in preferences) while we have COB
    if (profile.enableSMB_with_COB === true && meal_data.mealCOB) {
        if (meal_data.bwCarbs) {
            console.error("Warning: SMB enabled with Bolus Wizard carbs: be sure to easy bolus 30s before using Bolus Wizard");
        } else {
            console.error("SMB enabled for COB of " + meal_data.mealCOB);
        }
        return true;
    }

    // enable SMB/UAM (if enabled in preferences) for a full 6 hours after any carb entry
    // (6 hours is defined in carbWindow in lib/meal/total.js)
    if (profile.enableSMB_after_carbs === true && meal_data.carbs ) {
        if (meal_data.bwCarbs) {
            console.error("Warning: SMB enabled with Bolus Wizard carbs: be sure to easy bolus 30s before using Bolus Wizard");
        } else {
            console.error("SMB enabled for 6h after carb entry");
        }
        return true;
    }

    // enable SMB/UAM (if enabled in preferences) if a low temptarget is set
    if (profile.enableSMB_with_temptarget === true && (profile.temptargetSet && target_bg < 100)) {
        if (meal_data.bwFound) {
            console.error("Warning: SMB enabled within 6h of using Bolus Wizard: be sure to easy bolus 30s before using Bolus Wizard");
        } else {
            console.error("SMB enabled for temptarget of " + convert_bg(target_bg, profile));
        }
        return true;
    }

    // enable SMB if high bg is found
    if (profile.enableSMB_high_bg === true && high_bg !== null && bg >= high_bg) {
        console.error("Checking BG to see if High for SMB enablement.");
        console.error("Current BG", bg, " | High BG ", high_bg);
        if (meal_data.bwFound) {
            console.error("Warning: High BG SMB enabled within 6h of using Bolus Wizard: be sure to easy bolus 30s before using Bolus Wizard");
        } else {
            console.error("High BG detected. Enabling SMB.");
        }
        return true;
    }

    console.error("SMB disabled (no enableSMB preferences active or no condition satisfied)");
    return false;
}

var determine_basal = function determine_basal(glucose_status, currenttemp, iob_data, profile, autosens_data, meal_data, tempBasalFunctions, microBolusAllowed, reservoir_data, currentTime, pumphistory, preferences, basalprofile, oref2_variables) {

    var profileTarget = profile.min_bg;
    var overrideTarget = oref2_variables.overrideTarget;
    if (overrideTarget != 0 && oref2_variables.useOverride && !profile.temptargetSet) {
        profileTarget = overrideTarget;
    }
    const smbIsOff = oref2_variables.smbIsOff;
    const advancedSettings = oref2_variables.advancedSettings;
    const isfAndCr = oref2_variables.isfAndCr;
    const isf = oref2_variables.isf;
    const cr_ = oref2_variables.cr;
    const smbIsAlwaysOff = oref2_variables.smbIsAlwaysOff;
    const start = oref2_variables.start;
    const end = oref2_variables.end;
    const smbMinutes = oref2_variables.smbMinutes;
    const uamMinutes = oref2_variables.uamMinutes;

    var insulinForManualBolus = 0;
    var manualBolusErrorString = 0;
    var threshold = profileTarget;

    // tdd past 24 hours
    var pumpData = 0;
    var logtdd = "";
    var logBasal = "";
    var logBolus = "";
    var logTempBasal = "";
    var dataLog = "";
    var logOutPut = "";
    var current = 0;
    var tdd = 0;
    var insulin = 0;
    var tempInsulin = 0;
    var bolusInsulin = 0;
    var scheduledBasalInsulin = 0;
    var quota = 0;
    const weightedAverage = oref2_variables.weightedAverage;
    var overrideFactor = 1;
    var sensitivity = profile.sens;
    var carbRatio = profile.carb_ratio;
    if (oref2_variables.useOverride) {
        overrideFactor = oref2_variables.overridePercentage / 100;
        if (isfAndCr) {
            sensitivity /= overrideFactor;
            carbRatio /= overrideFactor;
        } else {
            if (cr_) { carbRatio /= overrideFactor; }
            if (isf) { sensitivity /= overrideFactor; }
        }
    }
    const weightPercentage = profile.weightPercentage;
    const average_total_data = oref2_variables.average_total_data;

    function addTimeToDate(objDate, _hours) {
        var ms = objDate.getTime();
        var add_ms = _hours * 36e5;
        var newDateObj = new Date(ms + add_ms);
        return newDateObj;
    }

    function subtractTimeFromDate(date, hours_) {
        var ms_ = date.getTime();
        var add_ms_ = hours_ * 36e5;
        var new_date = new Date(ms_ - add_ms_);
        return new_date;
    }

    function accountForIncrements(insulin) {
        // If you have not set this to.0.1 in iAPS settings, this will be set to 0.05 (Omnipods) in code.
        var minimalDose = profile.bolus_increment;
        if (minimalDose != 0.1) {
            minimalDose = 0.05;
        }
        var incrementsRaw = insulin / minimalDose;
        if (incrementsRaw >= 1) {
            var incrementsRounded = Math.floor(incrementsRaw);
            return round(incrementsRounded * minimalDose, 5);
        } else { return 0; }
    }

    function makeBaseString(base_timeStamp) {
        function addZero(i) {
            if (i < 10) { i = "0" + i }
            return i;
        }
        let hour = addZero(base_timeStamp.getHours());
        let minutes = addZero(base_timeStamp.getMinutes());
        let seconds = "00";
        let string = hour + ":" + minutes + ":" + seconds;
        return string;
    }

    function timeDifferenceOfString(string1, string2) {
        //Base time strings are in "00:00:00" format
        var time1 = new Date("1/1/1999 " + string1);
        var time2 = new Date("1/1/1999 " + string2);
        var ms1 = time1.getTime();
        var ms2 = time2.getTime();
        var difference = (ms1 - ms2) / 36e5;
        return difference;
    }

    function calcScheduledBasalInsulin(lastRealTempTime, addedLastTempTime) {
        var totalInsulin = 0;
        var old = addedLastTempTime;
        var totalDuration = (lastRealTempTime - addedLastTempTime) / 36e5;
        var basDuration = 0;
        var totalDurationCheck = totalDuration;
        var durationCurrentSchedule = 0;

        do {

            if (totalDuration > 0) {

                var baseTime_ = makeBaseString(old);

                //Default basalrate in case none is found...
                var basalScheduledRate_ = basalprofile[0].rate;
                for (let m = 0; m < basalprofile.length; m++) {

                    var timeToTest = basalprofile[m].start;

                    if (baseTime_ == timeToTest) {

                        if (m + 1 < basalprofile.length) {
                            let end = basalprofile[m+1].start;
                            let start = basalprofile[m].start;

                            durationCurrentSchedule = timeDifferenceOfString(end, start);

                            if (totalDuration >= durationCurrentSchedule) {
                                basDuration = durationCurrentSchedule;
                            } else if (totalDuration < durationCurrentSchedule) {
                                basDuration = totalDuration;
                            }

                        }
                        else if (m + 1 == basalprofile.length) {
                            let end = basalprofile[0].start;
                            let start = basalprofile[m].start;
                            // First schedule is 00:00:00. Changed places of start and end here.
                            durationCurrentSchedule = 24 - (timeDifferenceOfString(start, end));

                            if (totalDuration >= durationCurrentSchedule) {
                                basDuration = durationCurrentSchedule;
                            } else if (totalDuration < durationCurrentSchedule) {
                                basDuration = totalDuration;
                            }

                        }
                        basalScheduledRate_ = basalprofile[m].rate;
                        totalInsulin += accountForIncrements(basalScheduledRate_ * basDuration);
                        totalDuration -= basDuration;
                        console.log("Dynamic ratios log: scheduled insulin added: " + accountForIncrements(basalScheduledRate_ * basDuration) + " U. Bas duration: " + basDuration.toPrecision(3) + " h. Base Rate: " + basalScheduledRate_ + " U/h" + ". Time :" + baseTime_);
                        // Move clock to new date
                        old = addTimeToDate(old, basDuration);
                    }

                    else if (baseTime_ > timeToTest) {

                        if (m + 1 < basalprofile.length) {
                            var timeToTest2 = basalprofile[m+1].start

                            if (baseTime_ < timeToTest2) {

                               //  durationCurrentSchedule = timeDifferenceOfString(end, start);
                               durationCurrentSchedule = timeDifferenceOfString(timeToTest2, baseTime_);

                                if (totalDuration >= durationCurrentSchedule) {
                                    basDuration = durationCurrentSchedule;
                                } else if (totalDuration < durationCurrentSchedule) {
                                    basDuration = totalDuration;
                                }

                                basalScheduledRate_ = basalprofile[m].rate;
                                totalInsulin += accountForIncrements(basalScheduledRate_ * basDuration);
                                totalDuration -= basDuration;
                                console.log("Dynamic ratios log: scheduled insulin added: " + accountForIncrements(basalScheduledRate_ * basDuration) + " U. Bas duration: " + basDuration.toPrecision(3) + " h. Base Rate: " + basalScheduledRate_ + " U/h" + ". Time :" + baseTime_);
                                // Move clock to new date
                                old = addTimeToDate(old, basDuration);
                            }
                        }

                        else if (m == basalprofile.length - 1) {
                            // let start = basalprofile[m].start;
                            let start = baseTime_;
                            // First schedule is 00:00:00. Changed places of start and end here.
                            durationCurrentSchedule = timeDifferenceOfString("23:59:59", start);

                            if (totalDuration >= durationCurrentSchedule) {
                                basDuration = durationCurrentSchedule;
                            } else if (totalDuration < durationCurrentSchedule) {
                                basDuration = totalDuration;
                            }

                            basalScheduledRate_ = basalprofile[m].rate;
                            totalInsulin += accountForIncrements(basalScheduledRate_ * basDuration);
                            totalDuration -= basDuration;
                            console.log("Dynamic ratios log: scheduled insulin added: " + accountForIncrements(basalScheduledRate_ * basDuration) + " U. Bas duration: " + basDuration.toPrecision(3) + " h. Base Rate: " + basalScheduledRate_ + " U/h" + ". Time :" + baseTime_);
                            // Move clock to new date
                            old = addTimeToDate(old, basDuration);
                        }
                    }
                }
            }
            //totalDurationCheck to avoid infinite loop
        } while (totalDuration > 0 && totalDuration < totalDurationCheck);

        // amount of insulin according to pump basal rate schedules
        return totalInsulin;
    }

    // Check that there is enough pump history data (>21 hours) for tdd calculation. Estimate the missing hours (24-pumpData) using hours with scheduled basal rates. Not perfect, but sometimes the
    // pump history in FAX is only 22-23.5 hours, even when you've been looping with FAX for many days. This is to reduce the error from just using pump history as data source as much as possible.
    // AT basal rates are not used for this estimation, instead the basal rates in pump settings.

    // Check for empty pump history (new FAX loopers). If empty: don't use dynamic settings!

    if (!pumphistory.length) {
        console.log("Pumphistory is empty!");
        dynISFenabled = false;
        enableDynamicCR = false;
    } else {
        let phLastEntry = pumphistory.length - 1;
        var endDate = new Date(pumphistory[phLastEntry].timestamp);
        var startDate = new Date(pumphistory[0].timestamp);

        // If latest pump event is a temp basal
        if (pumphistory[0]._type == "TempBasalDuration") {
            startDate = new Date();
        }
        pumpData = (startDate - endDate) / 36e5;

        if (pumpData < 23.9 && pumpData > 21) {
            var missingHours = 24 - pumpData;
            // Makes new end date for a total time duration of exakt 24 hour.
            var endDate_ = subtractTimeFromDate(endDate, missingHours);
            // endDate - endDate_ = missingHours
            scheduledBasalInsulin = calcScheduledBasalInsulin(endDate, endDate_);
            dataLog = "24 hours of data is required for an accurate tdd calculation. Currently only " + pumpData.toPrecision(3) + " hours of pump history data are available. Using your pump scheduled basals to fill in the missing hours. Scheduled basals added: " + scheduledBasalInsulin.toPrecision(5) + " U. ";
        } else if (pumpData < 21) {
            dynISFenabled = false;
            enableDynamicCR = false;
        } else {  dataLog = ""; }
    }

    // Calculate tdd ----------------------------------------------------------------------

    //Bolus:
    for (let i = 0; i < pumphistory.length; i++) {
        if (pumphistory[i]._type == "Bolus") {
            bolusInsulin += pumphistory[i].amount;
        }
    }

    // Temp basals:
    for (let j = 1; j < pumphistory.length; j++) {
        if (pumphistory[j]._type == "TempBasal" && pumphistory[j].rate > 0) {
            current = j;
            quota = pumphistory[j].rate;
            var duration = pumphistory[j-1]['duration (min)'] / 60;
            var origDur = duration;
            var pastTime = new Date(pumphistory[j-1].timestamp);
            var morePresentTime = pastTime;
            var substractTimeOfRewind = 0;
            // If temp basal hasn't yet ended, use now as end date for calculation
            do {
                j--;
                if (j == 0) {
                    morePresentTime =  new Date();
                    break;
                }
                else if (pumphistory[j]._type == "TempBasal" || pumphistory[j]._type == "PumpSuspend")  {
                    morePresentTime = new Date(pumphistory[j].timestamp);
                    break;
                }
                // During the time the Medtronic pumps are rewinded and primed, this duration of suspened insulin delivery needs to be accounted for.
                var pp = j-2;
                if (pp >= 0) {
                    if (pumphistory[pp]._type == "Rewind") {
                        let rewindTimestamp = pumphistory[pp].timestamp;
                        // There can be several Prime events
                        while (pp - 1 >= 0) {
                            pp -= 1;
                            if (pumphistory[pp]._type == "Prime") {
                                substractTimeOfRewind = (pumphistory[pp].timestamp - rewindTimestamp) / 36e5;
                            } else { break }
                        }

                        // If Medtronic user forgets to insert infusion set
                        if (substractTimeOfRewind >= duration) {
                            morePresentTime = rewindTimestamp;
                            substractTimeOfRewind = 0;
                        }
                    }
                }
            }
            while (j > 0);

            var diff = (morePresentTime - pastTime) / 36e5;
            if (diff < origDur) {
                duration = diff;
            }

            insulin = quota * (duration - substractTimeOfRewind);
            tempInsulin += accountForIncrements(insulin);
            j = current;
        }
    }
    //  Check and count for when basals are delivered with a scheduled basal rate.
    //  1. Check for 0 temp basals with 0 min duration. This is for when ending a manual temp basal and (perhaps) continuing in open loop for a while.
    //  2. Check for temp basals that completes. This is for when disconnected from link/iphone, or when in open loop.
    //  3. Account for a punp suspension. This is for when pod screams or when MDT or pod is manually suspended.
    //  4. Account for a pump resume (in case pump/cgm is disconnected before next loop).
    //  To do: are there more circumstances when scheduled basal rates are used? Do we need to care about "Prime" and "Rewind" with MDT pumps?
    //
    for (let k = 0; k < pumphistory.length; k++) {
        // Check for 0 temp basals with 0 min duration.
        insulin = 0;
        if (pumphistory[k]['duration (min)'] == 0 || pumphistory[k]._type == "PumpResume") {
            let time1 = new Date(pumphistory[k].timestamp);
            let time2 = time1;
            let l = k;
            do {
                if (l > 0) {
                    --l;
                    if (pumphistory[l]._type == "TempBasal") {
                        time2 = new Date(pumphistory[l].timestamp);
                        break;
                    }
                }
            } while (l > 0);
            // duration of current scheduled basal in h
            let basDuration = (time2 - time1) / 36e5;

            if (basDuration > 0) {
                scheduledBasalInsulin += calcScheduledBasalInsulin(time2, time1);
            }
        }
    }

    // Check for temp basals that completes
    for (let n = pumphistory.length -1; n > 0; n--) {
        if (pumphistory[n]._type == "TempBasalDuration") {
            // duration in hours
            let oldBasalDuration = pumphistory[n]['duration (min)'] / 60;
            // time of old temp basal
            let oldTime = new Date(pumphistory[n].timestamp);
            var newTime = oldTime;
            let o = n;
            do {
                --o;
                if (o >= 0) {
                    if (pumphistory[o]._type == "TempBasal" || pumphistory[o]._type == "PumpSuspend") {
                        // time of next (new) temp basal or a pump suspension
                        newTime = new Date(pumphistory[o].timestamp);
                        break;
                    }
                }
            } while (o > 0);

            // When latest temp basal is index 0 in pump history
            if (n == 0 && pumphistory[0]._type == "TempBasalDuration") {
                newTime = new Date();
                oldBasalDuration = pumphistory[n]['duration (min)'] / 60;
            }

            let tempBasalTimeDifference = (newTime - oldTime) / 36e5;
            let timeOfbasal = tempBasalTimeDifference - oldBasalDuration;
            // if duration of scheduled basal is more than 0
            if (timeOfbasal > 0) {
                // Timestamp after completed temp basal
                let timeOfScheduledBasal =  addTimeToDate(oldTime, oldBasalDuration);
                scheduledBasalInsulin += calcScheduledBasalInsulin(newTime, timeOfScheduledBasal);
            }
        }
    }

    tdd = bolusInsulin + tempInsulin + scheduledBasalInsulin;

    var insulin_ = {
        TDD: round(tdd, 5),
        bolus: round(bolusInsulin, 5),
        temp_basal: round(tempInsulin, 5),
        scheduled_basal: round(scheduledBasalInsulin, 5)
    }
    var tdd_before = tdd;

    if (pumpData > 21) {
        logBolus = ". Bolus insulin: " + bolusInsulin.toPrecision(5) + " U";
        logTempBasal = ". Temporary basal insulin: " + tempInsulin.toPrecision(5) + " U";
        logBasal = ". Insulin with scheduled basal rate: " + scheduledBasalInsulin.toPrecision(5) + " U";
        logtdd = " TDD past 24h is: " + tdd.toPrecision(5) + " U";
        logOutPut = dataLog + logtdd + logBolus + logTempBasal + logBasal;




        tddReason = ", TDD: " + round(tdd,2) + " U, " + round(bolusInsulin/tdd*100,0) + "% Bolus " + round((tempInsulin+scheduledBasalInsulin)/tdd*100,0) +  "% Basal";

    } else { tddReason = ", TDD: Not enough pumpData (< 21h)"; }

    // -------------------- END OF TDD ----------------------------------------------------

    // Dynamic ratios
    const BG = glucose_status.glucose;
    var dynISFenabled = preferences.useNewFormula
    const useDynamicCR = preferences.enableDynamicCR;

    // In case the autosens.min/max limits are reversed:
    const minLimitChris = Math.min(profile.autosens_min, profile.autosens_max);
    const maxLimitChris = Math.max(profile.autosens_min, profile.autosens_max);

    // Turn off when autosens.min = autosens.max
    if (maxLimitChris == minLimitChris || maxLimitChris < 1 || minLimitChris > 1) {
        dynISFenabled = false;
        console.log("Dynamic ISF disabled due to current autosens settings");
    }

    const adjustmentFactor = preferences.adjustmentFactor;
    const currentMinTarget = profileTarget;
    var exerciseSetting = false;
    var log = "";
    var tdd24h_14d_Ratio = 1;
    var basal_ratio_log = "";


    if (average_total_data > 0) {
        tdd24h_14d_Ratio = weightedAverage / average_total_data;
    }

    // respect autosens_max/min for tdd24h_14d_Ratio, used to adjust basal similarly as autosens
    if (tdd24h_14d_Ratio > 1) {
        tdd24h_14d_Ratio = Math.min(tdd24h_14d_Ratio, profile.autosens_max);
        tdd24h_14d_Ratio = round(tdd24h_14d_Ratio,2);
        basal_ratio_log = "Basal adjustment with a 24 hour  to total average (up to 14 days of data) TDD ratio (limited by Autosens max setting). Basal Ratio: " + tdd24h_14d_Ratio + ". Upper limit = Autosens max (" + profile.autosens_max + ")";
    }
    else if (tdd24h_14d_Ratio < 1) {
        tdd24h_14d_Ratio = Math.max(tdd24h_14d_Ratio, profile.autosens_min);
        tdd24h_14d_Ratio = round(tdd24h_14d_Ratio,2);
        basal_ratio_log = "Basal adjustment with a 24 hour to  to total average (up to 14 days of data) TDD ratio (limited by Autosens min setting). Basal Ratio: " + tdd24h_14d_Ratio + ". Lower limit = Autosens min (" + profile.autosens_min + ")";
    }
    else {
        basal_ratio_log = "Basal adjusted with a 24 hour to total average (up to 14 days of data) TDD ratio: " + tdd24h_14d_Ratio;
    }

    basal_ratio_log = ", Basal ratio: " + tdd24h_14d_Ratio;

    // One of two exercise settings (they share the same purpose)

    if (profile.high_temptarget_raises_sensitivity || profile.exercise_mode || oref2_variables.isEnabled) {
    exerciseSetting = true;
    }

    // Turn off Chris' formula when using a temp target >= 118 (6.5 mol/l) and if an exercise setting is enabled.
    if (currentMinTarget >= 118 && exerciseSetting) {
        dynISFenabled = false;
        log = "Dynamic ISF temporarily off due to a high temp target/exercising. Current min target: " + currentMinTarget;
    }

    var startLog = ", Dynamic ratios log: ";
    var afLog = ", AF: " + adjustmentFactor;
    var bgLog = "BG: " + BG + " mg/dl (" + (BG * 0.0555).toPrecision(2) + " mmol/l)";
    var formula = "";
    var weightLog = "";

    // Insulin curve
    const curve = preferences.curve;
    const ipt = profile.insulinPeakTime;
    const ucpk = preferences.useCustomPeakTime;
    var insulinFactor = 55; // deafult (120-65)
    var insulinPA = 65; // default (Novorapid/Novolog)

    switch (curve) {
        case "rapid-acting":
            insulinPA = 65;
            break;
        case "ultra-rapid":
            insulinPA = 50;
            break;
    }

    if (ucpk) {
        insulinFactor = 120 - ipt;
        console.log("Custom insulinpeakTime set to :" + ipt + ", insulinFactor: " + insulinFactor);
    } else {
        insulinFactor = 120 - insulinPA;
        console.log("insulinFactor set to : " + insulinFactor);
    }

    // Use weighted TDD average
    tdd_before = tdd;
    if (weightPercentage < 1 && weightedAverage > 0) {
        tdd = weightedAverage;
        console.log("Using weighted TDD average: " + round(tdd,2) + " U, instead of past 24 h (" + round(tdd_before,2) + " U), weight: " + weightPercentage);
        weightLog = ", Weighted TDD: " + round(tdd,2) + " U";
    }

    // Modified Chris Wilson's' formula with added adjustmentFactor for tuning and use of the autosens.ratio:
    // var newRatio = profile.sens * adjustmentFactor * tdd * BG / 277700;
    //
    // New logarithmic formula : var newRatio = profile.sens * adjustmentFactor * tdd * ln(( BG/insulinFactor) + 1 )) / 1800
    //

    const enable_sigmoid = preferences.sigmoid;
    var sigmoidLog = ""

    if (dynISFenabled) {
        var newRatio = sensitivity * adjustmentFactor * tdd * Math.log(BG/insulinFactor+1) / 1800;
        formula = ", Logarithmic formula";
    }

     // Sigmoid Function
    if (dynISFenabled && enable_sigmoid) {
        const as_min = minLimitChris;
        const autosens_interval = maxLimitChris - as_min;
        //Blood glucose deviation from set target (the lower BG target) converted to mmol/l to fit current formula.
        const bg_dev = (BG - profileTarget) * 0.0555;
        // Account for TDD of insulin. Compare last 2 hours with total data (up to 14 days)
        var tdd_factor = tdd24h_14d_Ratio; // weighted average TDD / total data average TDD
        var max_minus_one = maxLimitChris - 1;
        // Avoid division by 0
        if (maxLimitChris == 1) {
            max_minus_one = maxLimitChris + 0.01 - 1;
        }
        //Makes sigmoid factor(y) = 1 when BG deviation(x) = 0.
        const fix_offset = (Math.log10(1/max_minus_one-as_min/max_minus_one) / Math.log10(Math.E));
        //Exponent used in sigmoid formula
        const exponent = bg_dev * adjustmentFactor * tdd_factor + fix_offset;
        // The sigmoid function
        const sigmoid_factor = autosens_interval / (1 + Math.exp(-exponent)) + as_min;
        newRatio = sigmoid_factor;
        formula = ", Sigmoid function";
        // Dynamic CR will be processed further down
    }

    var cr = carbRatio;
    const cr_before = round(carbRatio, 1);
    var log_isfCR = "";
    var limitLog = "";

    if (dynISFenabled && tdd > 0) {

        log_isfCR = ", Dynamic ISF/CR: On/";

        // Respect autosens.max and autosens.min limitLogs
        if (newRatio > maxLimitChris) {
            log = ", Dynamic ISF limited by autosens_max setting: " + maxLimitChris + " (" +  round(newRatio,2) + "), ";
            limitLog = ", Autosens/Dynamic Limit: " + maxLimitChris + " (" +  round(newRatio,2) + ")";
            newRatio = maxLimitChris;
        } else if (newRatio < minLimitChris) {
            log = ", Dynamic ISF limited by autosens_min setting: " + minLimitChris + " (" +  round(newRatio,2) + "). ";
            limitLog = ", Autosens/Dynamic Limit: " + minLimitChris + " (" +  round(newRatio,2) + ")";
            newRatio = minLimitChris;
        }

        // Dynamic CR (Test)
        if (useDynamicCR) {
            log_isfCR += "On";
            var dynCR = newRatio;

            /*
            // Lessen the ratio used by half, if newRatio > 1.
            if (newRatio > 1) {
                dynCR = (newRatio - 1) / 2 + 1;
            }

            cr = round(cr/dynCR, 2);
            var logCR = " CR: " + cr + " g/U";
            carbRatio = cr;
            */
            carbRatio /= dynCR;
            var logCR = ". New Dynamic CR: " + round(carbRatio, 1) + " g/U";

        } else {
            logCR = " CR: " + cr + " g/U";
            log_isfCR += "Off";
        }

        const isf = sensitivity / newRatio;

         // Set the new ratio
         autosens_data.ratio = newRatio;

        sigmoidLog = ". Using Sigmoid function, the autosens ratio has been adjusted with sigmoid factor to: " + round(autosens_data.ratio, 2) + ". New ISF = " + round(isf, 2) + " mg/dl (" + round(0.0555 * isf, 2) + " (mmol/l)" + ". CR adjusted from " + round(cr_before,2) + " to " + round(carbRatio,2);

        if (!enable_sigmoid) {
            log += ", Dynamic autosens.ratio set to " + round(newRatio,2) + " with ISF: " + isf.toPrecision(3) + " mg/dl/U (" + (isf * 0.0555).toPrecision(3) + " mmol/l/U)";
        } else { log += sigmoidLog }


        logOutPut += startLog + bgLog + afLog + formula + log + log_isfCR + logCR + weightLog;

    } else { logOutPut += startLog + "Dynamic Settings disabled"; }

    console.log(logOutPut);

    if (!dynISFenabled && !useDynamicCR) {
        tddReason += "";
    } else if (dynISFenabled && profile.tddAdjBasal) {
        tddReason += log_isfCR + formula + limitLog + afLog + basal_ratio_log;
    }
    else if (dynISFenabled && !profile.tddAdjBasal) { tddReason += log_isfCR + formula + limitLog + afLog; }

    // --------------- END OF DYNAMIC RATIOS CALCULATION  ------ A FEW LINES ADDED ALSO AT LINE NR 1136 and 1178 ------------------------------------------------


    // Set variables required for evaluating error conditions
    var rT = {}; //short for requestedTemp

    var deliverAt = new Date();
    if (currentTime) {
        deliverAt = currentTime;
    }

    if (typeof profile === 'undefined' || typeof profile.current_basal === 'undefined') {
        rT.error ='Error: could not get current basal rate';
        return rT;
    }
    var profile_current_basal = round_basal(profile.current_basal, profile) * overrideFactor;
    var basal = profile_current_basal;

    // Print Current Override factor, if any
    if (oref2_variables.useOverride) {
        if (oref2_variables.duration == 0) {
            console.log("Profile Override is active. Override " + round(overrideFactor * 100, 0) + "%. Override Duration: " + "Enabled indefinitely");
        } else
            console.log("Profile Override is active. Override " + round(overrideFactor * 100, 0) + "%. Override Expires in: " + oref2_variables.duration + " min.");
    }

    var systemTime = new Date();
    if (currentTime) {
        systemTime = currentTime;
    }
    var bgTime = new Date(glucose_status.date);
    var minAgo = round( (systemTime - bgTime) / 60 / 1000 ,1);

    var bg = glucose_status.glucose;
    var noise = glucose_status.noise;

// Prep various delta variables.
    var tick;

    if (glucose_status.delta > -0.5) {
        tick = "+" + round(glucose_status.delta,0);
    } else {
        tick = round(glucose_status.delta,0);
    }
    //var minDelta = Math.min(glucose_status.delta, glucose_status.short_avgdelta, glucose_status.long_avgdelta);
    var minDelta = Math.min(glucose_status.delta, glucose_status.short_avgdelta);
    var minAvgDelta = Math.min(glucose_status.short_avgdelta, glucose_status.long_avgdelta);
    var maxDelta = Math.max(glucose_status.delta, glucose_status.short_avgdelta, glucose_status.long_avgdelta);


// Cancel high temps (and replace with neutral) or shorten long zero temps for various error conditions

    // 38 is an xDrip error state that usually indicates sensor failure
    // all other BG values between 11 and 37 mg/dL reflect non-error-code BG values, so we should zero temp for those
// First, print out different explanations for each different error condition
    if (bg <= 10 || bg === 38 || noise >= 3) {  //Dexcom is in ??? mode or calibrating, or xDrip reports high noise
        rT.reason = "CGM is calibrating, in ??? state, or noise is high";
    }
    var tooflat=false;
    if (bg > 60 && glucose_status.delta == 0 && glucose_status.short_avgdelta > -1 && glucose_status.short_avgdelta < 1 && glucose_status.long_avgdelta > -1 && glucose_status.long_avgdelta < 1) {
        if (glucose_status.device == "fakecgm") {
            console.error("CGM data is unchanged (" + convert_bg(bg,profile) + "+" + convert_bg(glucose_status.delta,profile)+ ") for 5m w/ " + convert_bg(glucose_status.short_avgdelta,profile) + " mg/dL ~15m change & " + convert_bg(glucose_status.long_avgdelta,2) + " mg/dL ~45m change");
            console.error("Simulator mode detected (" + glucose_status.device + "): continuing anyway");
        } else {
            tooflat=true;
        }
    }

    if (minAgo > 12 || minAgo < -5) { // Dexcom data is too old, or way in the future
        rT.reason = "If current system time " + systemTime + " is correct, then BG data is too old. The last BG data was read "+minAgo+"m ago at "+bgTime;

        // if BG is too old/noisy, or is completely unchanging, cancel any high temps and shorten any long zero temps
    } else if ( glucose_status.short_avgdelta === 0 && glucose_status.long_avgdelta === 0 ) {
        if ( glucose_status.last_cal && glucose_status.last_cal < 3 ) {
            rT.reason = "CGM was just calibrated";
        } else {
            rT.reason = "CGM data is unchanged (" + convert_bg(bg,profile) + "+" + convert_bg(glucose_status.delta,profile) + ") for 5m w/ " + convert_bg(glucose_status.short_avgdelta,profile) + " mg/dL ~15m change & " + convert_bg(glucose_status.long_avgdelta,profile) + " mg/dL ~45m change";
        }
    }
    if (bg <= 10 || bg === 38 || noise >= 3 || minAgo > 12 || minAgo < -5 || ( glucose_status.short_avgdelta === 0 && glucose_status.long_avgdelta === 0 ) ) {
        if (currenttemp.rate >= basal) { // high temp is running
            rT.reason += ". Canceling high temp basal of " + currenttemp.rate;
            rT.deliverAt = deliverAt;
            rT.temp = 'absolute';
            rT.duration = 0;
            rT.rate = 0;
            return rT;
            // don't use setTempBasal(), as it has logic that allows <120% high temps to continue running
            //return tempBasalFunctions.setTempBasal(basal, 30, profile, rT, currenttemp);
        } else if ( currenttemp.rate === 0 && currenttemp.duration > 30 ) { //shorten long zero temps to 30m
            rT.reason += ". Shortening " + currenttemp.duration + "m long zero temp to 30m. ";
            rT.deliverAt = deliverAt;
            rT.temp = 'absolute';
            rT.duration = 30;
            rT.rate = 0;
            return rT;
            // don't use setTempBasal(), as it has logic that allows long zero temps to continue running
            //return tempBasalFunctions.setTempBasal(0, 30, profile, rT, currenttemp);
        } else { //do nothing.
            rT.reason += ". Temp " + currenttemp.rate + " <= current basal " + basal + "U/hr; doing nothing. ";
            return rT;
        }
    }

// Get configured target, and return if unable to do so.
// This should occur after checking that we're not in one of the CGM-data-related error conditions handled above,
// and before using target_bg to adjust sensitivityRatio below.
    var max_iob = profile.max_iob; // maximum amount of non-bolus IOB OpenAPS will ever deliver

    // if min and max are set, then set target to their average
    var target_bg;
    var min_bg;
    var max_bg;
    var high_bg;

    if (typeof profileTarget !== 'undefined') {
            min_bg = profileTarget;
    }
    if (typeof profile.max_bg !== 'undefined') {
            max_bg = profileTarget;
    }
    if (typeof profile.enableSMB_high_bg_target !== 'undefined') {
        high_bg = profile.enableSMB_high_bg_target;
    }
    if (typeof profileTarget !== 'undefined') {
        target_bg = profileTarget;

    } else {
        rT.error ='Error: could not determine target_bg. ';
        return rT;
    }


// Calculate sensitivityRatio based on temp targets, if applicable, or using the value calculated by autosens
//    var sensitivityRatio;
    var high_temptarget_raises_sensitivity = profile.exercise_mode || profile.high_temptarget_raises_sensitivity || oref2_variables.isEnabled;
    var normalTarget = 100; // evaluate high/low temptarget against 100, not scheduled target (which might change)
    var halfBasalTarget = 160;  // when temptarget is 160 mg/dL, run 50% basal (120 = 75%; 140 = 60%)
    // 80 mg/dL with low_temptarget_lowers_sensitivity would give 1.5x basal, but is limitLoged to autosens_max (1.2x by default)
    //if ( profile.half_basal_exercise_target ) {
    halfBasalTarget = profile.half_basal_exercise_target;
    //}

     if (oref2_variables.isEnabled) {
         const newHalfBasalTarget = oref2_variables.hbt;
         console.log("Half Basal Target used: " + convert_bg(newHalfBasalTarget, profile) + " " + profile.out_units);
          halfBasalTarget = newHalfBasalTarget;
    } else { console.log("Default Half Basal Target used: " + convert_bg(halfBasalTarget, profile) + " " + profile.out_units) }

    if ( high_temptarget_raises_sensitivity && profile.temptargetSet && target_bg > normalTarget ||
        profile.low_temptarget_lowers_sensitivity && profile.temptargetSet && target_bg < normalTarget ||
        oref2_variables.isEnabled && profile.temptargetSet && target_bg < normalTarget ) {
        // w/ target 100, temp target 110 = .89, 120 = 0.8, 140 = 0.67, 160 = .57, and 200 = .44
        // e.g.: Sensitivity ratio set to 0.8 based on temp target of 120; Adjusting basal from 1.65 to 1.35; ISF from 58.9 to 73.6
        //sensitivityRatio = 2/(2+(target_bg-normalTarget)/40);
        var c = halfBasalTarget - normalTarget;
        // getting multiplication less or equal to 0 means that we have a really low target with a really low halfBasalTarget
        // with low TT and lowTTlowersSensitivity we need autosens_max as a value
        // we use multiplication instead of the division to avoid "division by zero error"
        if (c * (c + target_bg-normalTarget) <= 0.0) {
          sensitivityRatio = profile.autosens_max;
        }
        else {
          sensitivityRatio = c/(c+target_bg-normalTarget);
        }
        // limit sensitivityRatio to profile.autosens_max (1.2x by default)
        sensitivityRatio = Math.min(sensitivityRatio, profile.autosens_max);
        sensitivityRatio = round(sensitivityRatio,2);
        process.stderr.write("Sensitivity ratio set to "+sensitivityRatio+" based on temp target of "+target_bg+"; ");
    }
    else if (typeof autosens_data !== 'undefined' && autosens_data) {
        sensitivityRatio = autosens_data.ratio;
        // Override Profile.Target
    if (overrideTarget !== 0 && overrideTarget !== profile.min_bg && !profile.temptargetSet) {
        target_bg = overrideTarget;
        console.log("Current Override Profile Target: " + convert_bg(overrideTarget, profile) + " " + profile.out_units);
    }
        process.stderr.write("Autosens ratio: "+sensitivityRatio+"; ");
    }

    // Increase the dynamic ratio when using a low temp target
    if (profile.temptargetSet && target_bg < normalTarget && dynISFenabled && BG >= target_bg) {
        if (sensitivityRatio < newRatio) {
            autosens_data.ratio = newRatio * (normalTarget/target_bg);
            //Use autosesns.max limit
            autosens_data.ratio = Math.min(autosens_data.ratio, profile.autosens_max);
            sensitivityRatio = round(autosens_data.ratio, 2);
            console.log("Dynamic ratio increased from " + round(newRatio, 2) + " to " + round(autosens_data.ratio,2) + " due to a low temp target (" + target_bg + ").");
        }
    }

    if (sensitivityRatio && !dynISFenabled) { // Disable adjustment of basal by sensitivityRatio when using dISF
        basal = profile.current_basal * overrideFactor * sensitivityRatio;
        basal = round_basal(basal, profile);
    }

    else if (dynISFenabled && profile.tddAdjBasal) {
        basal = profile.current_basal * tdd24h_14d_Ratio * overrideFactor;
        basal = round_basal(basal, profile);
        if (average_total_data > 0) {
            process.stderr.write("TDD-adjustment of basals activated, using tdd24h_14d_Ratio " + round(tdd24h_14d_Ratio,2) + ", TDD 24h = " + round(tdd_before,2) + "U, Weighted average TDD = " + round(weightedAverage,2) + "U, (Weight percentage = " + weightPercentage + "), Total data of TDDs (up to 14 days) average = " + round(average_total_data,2) + "U. " );
            if (basal !== profile_current_basal * overrideFactor) {
                process.stderr.write("Adjusting basal from " + profile_current_basal * overrideFactor + " U/h to " + basal + " U/h; ");
            } else { process.stderr.write("Basal unchanged: " + basal + " U/h; "); }
        }
    }

// Conversely, adjust BG target based on autosens ratio if no temp target is running
    // adjust min, max, and target BG for sensitivity, such that 50% increase in ISF raises target from 100 to 120
    if (profile.temptargetSet) {
        //process.stderr.write("Temp Target set, not adjusting with autosens; ");
    } else if (typeof autosens_data !== 'undefined' && autosens_data) {
        if ( profile.sensitivity_raises_target && autosens_data.ratio < 1 || profile.resistance_lowers_target && autosens_data.ratio > 1 ) {
            // with a target of 100, default 0.7-1.2 autosens min/max range would allow a 93-117 target range
            min_bg = round((min_bg - 60) / autosens_data.ratio) + 60;
            max_bg = round((max_bg - 60) / autosens_data.ratio) + 60;
            var new_target_bg = round((target_bg - 60) / autosens_data.ratio) + 60;
            // don't allow target_bg below 80
            new_target_bg = Math.max(80, new_target_bg);
            if (target_bg === new_target_bg) {
                process.stderr.write("target_bg unchanged: " + convert_bg(new_target_bg, profile) + "; ");
            } else {
                process.stderr.write("target_bg from "+ convert_bg(new_target_bg, profile) + " to " + convert_bg(new_target_bg, profile) + "; ");
            }
            target_bg = new_target_bg;
        }
    }

    // Display if differing in enacted box
    var targetLog = convert_bg(target_bg, profile);
    if  (target_bg != profileTarget) {
        if (overrideTarget !== 0 && overrideTarget !== target_bg) {
            targetLog = convert_bg(profileTarget, profile) + "\u2192" + convert_bg(overrideTarget, profile) + "\u2192" + convert_bg(target_bg, profile);
        } else {
            targetLog = convert_bg(profileTarget, profile) + "\u2192" + convert_bg(target_bg, profile);
        }
    }

    // Raise target for noisy / raw CGM data.
    var adjustedMinBG = 200;
    var adjustedTargetBG = 200;
    var adjustedMaxBG = 200;
    if (glucose_status.noise >= 2) {
        // increase target at least 10% (default 30%) for raw / noisy data
        var noisyCGMTargetMultiplier = Math.max( 1.1, profile.noisyCGMTargetMultiplier );
        // don't allow maxRaw above 250
        var maxRaw = Math.min( 250, profile.maxRaw );
        adjustedMinBG = round(Math.min(200, min_bg * noisyCGMTargetMultiplier ));
        adjustedTargetBG = round(Math.min(200, target_bg * noisyCGMTargetMultiplier ));
        adjustedMaxBG = round(Math.min(200, max_bg * noisyCGMTargetMultiplier ));
        process.stderr.write("Raising target_bg for noisy / raw CGM data, from " + convert_bg(new_target_bg, profile) + " to " + convert_bg(adjustedTargetBG, profile) + "; ");
        min_bg = adjustedMinBG;
        target_bg = adjustedTargetBG;
        max_bg = adjustedMaxBG;
    }

    // min_bg of 90 -> threshold of 65, 100 -> 70 110 -> 75, and 130 -> 85
    threshold = min_bg - 0.5*(min_bg-40);
    // Use the configurable threshold setting
    var th_setting = profile.threshold_setting;
    if (th_setting > threshold && th_setting <= 120 && th_setting >= 65) {
        console.error("Threshold changed in settings from " + convert_bg(threshold, profile) + " to " + convert_bg(th_setting, profile) + ". ");
        threshold = th_setting;
    } else { console.error("Current threshold: " +  convert_bg(threshold, profile)); }

// If iob_data or its required properties are missing, return.
// This has to be checked after checking that we're not in one of the CGM-data-related error conditions handled above,
// and before attempting to use iob_data below.

// Adjust ISF based on sensitivityRatio
    var isfreason = ""
    var profile_sens = round(sensitivity,1);
    var sens = sensitivity;
    if (typeof autosens_data !== 'undefined' && autosens_data) {
        sens = sensitivity / sensitivityRatio;
        sens = round(sens, 1);
        if (sens !== sensitivity) {
            process.stderr.write("ISF from "+ convert_bg(sensitivity,profile) +" to " + convert_bg(sens,profile));
        } else {
            process.stderr.write("ISF unchanged: "+ convert_bg(sens,profile));
        }
        //process.stderr.write(" (autosens ratio "+sensitivityRatio+")");
        isfreason += "Autosens ratio: " + round(sensitivityRatio, 2) + ", ISF: " + convert_bg(sensitivity,profile) + "\u2192" + convert_bg(sens,profile);

    }
    console.error("CR:" + carbRatio);

    if (typeof iob_data === 'undefined' ) {
        rT.error ='Error: iob_data undefined. ';
        return rT;
    }

    var iobArray = iob_data;

    if (typeof(iob_data.length) && iob_data.length > 1) {
        iob_data = iobArray[0];
    }

    if (typeof iob_data.activity === 'undefined' || typeof iob_data.iob === 'undefined' ) {
        rT.error ='Error: iob_data missing some property. ';
        return rT;
    }

// Compare currenttemp to iob_data.lastTemp and cancel temp if they don't match, as a safety check
// This should occur after checking that we're not in one of the CGM-data-related error conditions handled above,
// and before returning (doing nothing) below if eventualBG is undefined.
    var lastTempAge;
    if (typeof iob_data.lastTemp !== 'undefined' ) {
        lastTempAge = round(( new Date(systemTime).getTime() - iob_data.lastTemp.date ) / 60000); // in minutes
    } else {
        lastTempAge = 0;
    }
    //console.error("currenttemp:",currenttemp,"lastTemp:",JSON.stringify(iob_data.lastTemp),"lastTempAge:",lastTempAge,"m");
    var tempModulus = (lastTempAge + currenttemp.duration) % 30;
    console.error("currenttemp:" + currenttemp.rate + " lastTempAge:" + lastTempAge + "m, tempModulus:" + tempModulus + "m");
    rT.temp = 'absolute';
    rT.deliverAt = deliverAt;
    if ( microBolusAllowed && currenttemp && iob_data.lastTemp && currenttemp.rate !== iob_data.lastTemp.rate && lastTempAge > 10 && currenttemp.duration ) {
        rT.reason = "Warning: currenttemp rate " + currenttemp.rate + " != lastTemp rate " + iob_data.lastTemp.rate + " from pumphistory; canceling temp"; // reason.conclusion started
        return tempBasalFunctions.setTempBasal(0, 0, profile, rT, currenttemp);
    }
    if ( currenttemp && iob_data.lastTemp && currenttemp.duration > 0 ) {
        //console.error(lastTempAge, round(iob_data.lastTemp.duration,1), round(lastTempAge - iob_data.lastTemp.duration,1));
        var lastTempEnded = lastTempAge - iob_data.lastTemp.duration;
        if ( lastTempEnded > 5 && lastTempAge > 10 ) {
            rT.reason = "Warning: currenttemp running but lastTemp from pumphistory ended " + lastTempEnded + "m ago; canceling temp"; // reason.conclusion started
            //console.error(currenttemp, round(iob_data.lastTemp,1), round(lastTempAge,1));
            return tempBasalFunctions.setTempBasal(0, 0, profile, rT, currenttemp);
        }
    }

// Calculate BGI, deviation, and eventualBG.
// This has to happen after we obtain iob_data

    //calculate BG impact: the amount BG "should" be rising or falling based on insulin activity alone
    var bgi = round(( -iob_data.activity * sens * 5 ), 2);
    // project deviations for 30 minutes
    var deviation = round( 30 / 5 * ( minDelta - bgi ) );
    // don't overreact to a big negative delta: use minAvgDelta if deviation is negative
    if (deviation < 0) {
        deviation = round( (30 / 5) * ( minAvgDelta - bgi ) );
        // and if deviation is still negative, use long_avgdelta
        if (deviation < 0) {
            deviation = round( (30 / 5) * ( glucose_status.long_avgdelta - bgi ) );
        }
    }

    // calculate the naive (bolus calculator math) eventual BG based on net IOB and sensitivity
    var naive_eventualBG = bg;
    if (iob_data.iob > 0) {
        naive_eventualBG = round( bg - (iob_data.iob * sens) );
    } else { // if IOB is negative, be more conservative and use the lower of sens, profile.sens
        naive_eventualBG = round( bg - (iob_data.iob * Math.min(sens, sensitivity) ) );
    }
    // and adjust it for the deviation above
    var eventualBG = naive_eventualBG + deviation;

    if (typeof eventualBG === 'undefined' || isNaN(eventualBG)) {
        rT.error ='Error: could not calculate eventualBG. Sensitivity: ' + sens + ' Deviation: ' + deviation;
        return rT;
    }
    var expectedDelta = calculate_expected_delta(target_bg, eventualBG, bgi);
    var minPredBG;
    var minGuardBG;



    //console.error(reservoir_data);

// Initialize rT (requestedTemp) object. Has to be done after eventualBG is calculated.
    rT = {
        'temp': 'absolute'
        , 'bg': bg
        , 'tick': tick
        , 'eventualBG': eventualBG
        , 'insulinReq': 0
        , 'reservoir' : reservoir_data // The expected reservoir volume at which to deliver the microbolus (the reservoir volume from right before the last pumphistory run)
        , 'deliverAt' : deliverAt // The time at which the microbolus should be delivered
        , 'sensitivityRatio' : sensitivityRatio
        , 'CR' : round(carbRatio, 1)
        , 'TDD': tdd_before
        , 'insulin': insulin_
        , 'current_target': target_bg
        , 'insulinForManualBolus': insulinForManualBolus
        , 'manualBolusErrorString': manualBolusErrorString
        , 'minDelta':  minDelta
        , 'expectedDelta':  expectedDelta
        , 'minGuardBG':  minGuardBG
        , 'minPredBG':  minPredBG
        , 'threshold': convert_bg(threshold, profile)
    };

// Generate predicted future BGs based on IOB, COB, and current absorption rate

// Initialize and calculate variables used for predicting BGs
    var COBpredBGs = [];
    var IOBpredBGs = [];
    var UAMpredBGs = [];
    var ZTpredBGs = [];
    COBpredBGs.push(bg);
    IOBpredBGs.push(bg);
    ZTpredBGs.push(bg);
    UAMpredBGs.push(bg);

    var enableSMB = enable_smb(
        profile,
        microBolusAllowed,
        meal_data,
        bg,
        target_bg,
        high_bg
    );

    if (smbIsOff) {
        if (!smbIsAlwaysOff) {
            console.error("SMBs are disabled (a Profile is active with SMBs disabled)");
            enableSMB = false;
        } else {
            let hour = currentTime.getHours();
            if (hour >= start && hour <= end) {
                console.error("SMB disabled by schedule (a Profile is active with SMBs disabled)");
                enableSMB = false;
            }
        }
    }

    var enableUAM = (profile.enableUAM);

    //console.error(meal_data);
    // carb impact and duration are 0 unless changed below
    var ci = 0;
    var cid = 0;
    // calculate current carb absorption rate, and how long to absorb all carbs
    // CI = current carb impact on BG in mg/dL/5m
    ci = round((minDelta - bgi),1);
    var uci = round((minDelta - bgi),1);
    // ISF (mg/dL/U) / CR (g/U) = CSF (mg/dL/g)

    // use autosens-adjusted sens to counteract autosens meal insulin dosing adjustments so that
    // autotuned CR is still in effect even when basals and ISF are being adjusted by TT or autosens
    // this avoids overdosing insulin for large meals when low temp targets are active
    csf = sens / carbRatio;
    console.error("profile.sens:" + convert_bg(sensitivity,profile) + ", sens:" + convert_bg(sens,profile) + ", CSF:" + round(csf,1));

    var maxCarbAbsorptionRate = 30; // g/h; maximum rate to assume carbs will absorb if no CI observed
    // limitLog Carb Impact to maxCarbAbsorptionRate * csf in mg/dL per 5m
    var maxCI = round(maxCarbAbsorptionRate*csf*5/60,1);
    if (ci > maxCI) {
        console.error("Limiting carb impact from " + ci + " to " + maxCI + "mg/dL/5m (" + maxCarbAbsorptionRate + "g/h)");
        ci = maxCI;
    }
    var remainingCATimeMin = 3; // h; minimum duration of expected not-yet-observed carb absorption
    // adjust remainingCATime (instead of CR) for autosens if sensitivityRatio defined
    if (sensitivityRatio) {
        remainingCATimeMin = remainingCATimeMin / sensitivityRatio;
    }
    // 20 g/h means that anything <= 60g will get a remainingCATimeMin, 80g will get 4h, and 120g 6h
    // when actual absorption ramps up it will take over from remainingCATime
    var assumedCarbAbsorptionRate = 20; // g/h; maximum rate to assume carbs will absorb if no CI observed
    var remainingCATime = remainingCATimeMin;
    if (meal_data.carbs) {
        // if carbs * assumedCarbAbsorptionRate > remainingCATimeMin, raise it
        // so <= 90g is assumed to take 3h, and 120g=4h
        remainingCATimeMin = Math.max(remainingCATimeMin, meal_data.mealCOB/assumedCarbAbsorptionRate);
        var lastCarbAge = round(( new Date(systemTime).getTime() - meal_data.lastCarbTime ) / 60000);
        //console.error(meal_data.lastCarbTime, lastCarbAge);

        var fractionCOBAbsorbed = ( meal_data.carbs - meal_data.mealCOB ) / meal_data.carbs;
        // if the lastCarbTime was 1h ago, increase remainingCATime by 1.5 hours
        remainingCATime = remainingCATimeMin + 1.5 * lastCarbAge/60;
        remainingCATime = round(remainingCATime,1);
        //console.error(fractionCOBAbsorbed, remainingCATimeAdjustment, remainingCATime)
        console.error("Last carbs " + lastCarbAge + " minutes ago; remainingCATime:" + remainingCATime + "hours; " + round(fractionCOBAbsorbed*100, 1) + "% carbs absorbed");
    }

    // calculate the number of carbs absorbed over remainingCATime hours at current CI
    // CI (mg/dL/5m) * (5m)/5 (m) * 60 (min/hr) * 4 (h) / 2 (linear decay factor) = total carb impact (mg/dL)
    var totalCI = Math.max(0, ci / 5 * 60 * remainingCATime / 2);
    // totalCI (mg/dL) / CSF (mg/dL/g) = total carbs absorbed (g)
    var totalCA = totalCI / csf;
    var remainingCarbsCap = 90; // default to 90
    var remainingCarbsFraction = 1;
    if (profile.remainingCarbsCap) { remainingCarbsCap = Math.min(90,profile.remainingCarbsCap); }
    if (profile.remainingCarbsFraction) { remainingCarbsFraction = Math.min(1,profile.remainingCarbsFraction); }
    var remainingCarbsIgnore = 1 - remainingCarbsFraction;
    var remainingCarbs = Math.max(0, meal_data.mealCOB - totalCA - meal_data.carbs*remainingCarbsIgnore);
    remainingCarbs = Math.min(remainingCarbsCap,remainingCarbs);
    // assume remainingCarbs will absorb in a /\ shaped bilinear curve
    // peaking at remainingCATime / 2 and ending at remainingCATime hours
    // area of the /\ triangle is the same as a remainingCIpeak-height rectangle out to remainingCATime/2
    // remainingCIpeak (mg/dL/5m) = remainingCarbs (g) * CSF (mg/dL/g) * 5 (m/5m) * 1h/60m / (remainingCATime/2) (h)
    var remainingCIpeak = remainingCarbs * csf * 5 / 60 / (remainingCATime/2);
    //console.error(profile.min_5m_carbimpact,ci,totalCI,totalCA,remainingCarbs,remainingCI,remainingCATime);

    // calculate peak deviation in last hour, and slope from that to current deviation
    var slopeFromMaxDeviation = round(meal_data.slopeFromMaxDeviation,2);
    // calculate lowest deviation in last hour, and slope from that to current deviation
    var slopeFromMinDeviation = round(meal_data.slopeFromMinDeviation,2);
    // assume deviations will drop back down at least at 1/3 the rate they ramped up
    var slopeFromDeviations = Math.min(slopeFromMaxDeviation,-slopeFromMinDeviation/3);
    //console.error(slopeFromMaxDeviation);

    //5m data points = g * (1U/10g) * (40mg/dL/1U) / (mg/dL/5m)
    // duration (in 5m data points) = COB (g) * CSF (mg/dL/g) / ci (mg/dL/5m)
    // limitLog cid to remainingCATime hours: the reset goes to remainingCI
    var nfcid = 0;
    if (ci === 0) {
        // avoid divide by zero
        cid = 0;
    } else { cid = Math.min(remainingCATime*60/5/2,Math.max(0, meal_data.mealCOB * csf / ci )); }

    // duration (hours) = duration (5m) * 5 / 60 * 2 (to account for linear decay)
    console.error("Carb Impact:" + ci + "mg/dL per 5m; CI Duration:" + round(cid*5/60*2,1) + "hours; remaining CI (" + remainingCATime/2 + "h peak):" + round(remainingCIpeak,1) + "mg/dL per 5m");

    var minIOBPredBG = 999;
    var minCOBPredBG = 999;
    var minUAMPredBG = 999;
    //minGuardBG = bg;
    var minCOBGuardBG = 999;
    var minUAMGuardBG = 999;
    var minIOBGuardBG = 999;
    var minZTGuardBG = 999;
    //var minPredBG;
    var avgPredBG;
    var IOBpredBG = eventualBG;
    var maxIOBPredBG = bg;
    var maxCOBPredBG = bg;
    var maxUAMPredBG = bg;
    var eventualPredBG = bg;
    var lastIOBpredBG;
    var lastCOBpredBG;
    var lastUAMpredBG;
    var lastZTpredBG;
    var UAMduration = 0;
    var remainingCItotal = 0;
    var remainingCIs = [];
    var predCIs = [];
    try {
        iobArray.forEach(function(iobTick) {
            //console.error(iobTick);
            var predBGI = round(( -iobTick.activity * sens * 5 ), 2);
            var predZTBGI = round(( -iobTick.iobWithZeroTemp.activity * sens * 5 ), 2);
            var ZTpredBG = naive_eventualBG;

            // for IOBpredBGs, predicted deviation impact drops linearly from current deviation down to zero
            // over 60 minutes (data points every 5m)
            var predDev = ci * ( 1 - Math.min(1,IOBpredBGs.length/(60/5)) );

            // Adding dynamic ISF in predictions for ZT and IOB. Modification from Tim Street's AAPS but with default as off:
            switch(true) {
                case dynISFenabled && !enable_sigmoid:
                    //IOBpredBG = IOBpredBGs[IOBpredBGs.length-1] + predBGI + predDev; // Adding dynamic ISF in predictions for UAM, ZT and IOB:
                    IOBpredBG = IOBpredBGs[IOBpredBGs.length-1] + (round(( -iobTick.activity * (1800 / ( tdd * adjustmentFactor * (Math.log((Math.max( IOBpredBGs[IOBpredBGs.length-1],39) / insulinFactor ) + 1 ) ) )) * 5 ),2)) + predDev;
                    //var ZTpredBG = ZTpredBGs[ZTpredBGs.length-1] + predZTBGI; // Adding dynamic ISF in predictions for UAM, ZT and IOB:
                    ZTpredBG = ZTpredBGs[ZTpredBGs.length-1] + (round(( -iobTick.iobWithZeroTemp.activity * (1800 / ( tdd * adjustmentFactor * (Math.log(( Math.max(ZTpredBGs[ZTpredBGs.length-1],39) / insulinFactor ) + 1 ) ) )) * 5 ), 2));
                    console.log("Dynamic ISF (Logarithmic Formula) )adjusted predictions for IOB and ZT: IOBpredBG: " + round(IOBpredBG,2) + " , ZTpredBG: " + round(ZTpredBG,2));
                    break;
                default:
                    IOBpredBG = IOBpredBGs[IOBpredBGs.length-1] + predBGI + predDev;
                    // calculate predBGs with long zero temp without deviations
                    ZTpredBG = ZTpredBGs[ZTpredBGs.length-1] + predZTBGI;
            }

            // for COBpredBGs, predicted carb impact drops linearly from current carb impact down to zero
            // eventually accounting for all carbs (if they can be absorbed over DIA)
            var predCI = Math.max(0, Math.max(0,ci) * ( 1 - COBpredBGs.length/Math.max(cid*2,1) ) );
            // if any carbs aren't absorbed after remainingCATime hours, assume they'll absorb in a /\ shaped
            // bilinear curve peaking at remainingCIpeak at remainingCATime/2 hours (remainingCATime/2*12 * 5m)
            // and ending at remainingCATime h (remainingCATime*12 * 5m intervals)
            var intervals = Math.min( COBpredBGs.length, (remainingCATime*12)-COBpredBGs.length );
            var remainingCI = Math.max(0, intervals / (remainingCATime/2*12) * remainingCIpeak );
            remainingCItotal += predCI+remainingCI;
            remainingCIs.push(round(remainingCI,0));
            predCIs.push(round(predCI,0));
            //process.stderr.write(round(predCI,1)+"+"+round(remainingCI,1)+" ");
            COBpredBG = COBpredBGs[COBpredBGs.length-1] + predBGI + Math.min(0,predDev) + predCI + remainingCI;
            // for UAMpredBGs, predicted carb impact drops at slopeFromDeviations
            // calculate predicted CI from UAM based on slopeFromDeviations
            var predUCIslope = Math.max(0, uci + ( UAMpredBGs.length*slopeFromDeviations ) );
            // if slopeFromDeviations is too flat, predicted deviation impact drops linearly from
            // current deviation down to zero over 3h (data points every 5m)
            var predUCImax = Math.max(0, uci * ( 1 - UAMpredBGs.length/Math.max(3*60/5,1) ) );
            //console.error(predUCIslope, predUCImax);
            // predicted CI from UAM is the lesser of CI based on deviationSlope or DIA
            var predUCI = Math.min(predUCIslope, predUCImax);
            if(predUCI>0) {
                //console.error(UAMpredBGs.length,slopeFromDeviations, predUCI);
                UAMduration=round((UAMpredBGs.length+1)*5/60,1);
            }

            // Adding dynamic ISF in predictions for UAM. Modification from Tim Street's AAPS but with default as off:
            switch(true) {
                case dynISFenabled && !enable_sigmoid:
                    //UAMpredBG = UAMpredBGs[UAMpredBGs.length-1] + predBGI + Math.min(0, predDev) + predUCI; // Adding dynamic ISF in predictions for UAM:
                    UAMpredBG = UAMpredBGs[UAMpredBGs.length-1] + (round(( -iobTick.activity * (1800 / ( tdd * adjustmentFactor * (Math.log(( Math.max(UAMpredBGs[UAMpredBGs.length-1],39) / insulinFactor ) + 1 ) ) )) * 5 ),2)) + Math.min(0, predDev) + predUCI;
                    console.log("Dynamic ISF (Logarithmic Formula) adjusted prediction for UAM: UAMpredBG: " + round(UAMpredBG,2));
                    break;
                default:
                    UAMpredBG = UAMpredBGs[UAMpredBGs.length-1] + predBGI + Math.min(0, predDev) + predUCI;
            }
            //console.error(predBGI, predCI, predUCI);
            // truncate all BG predictions at 4 hours
            if ( IOBpredBGs.length < 48 ) { IOBpredBGs.push(IOBpredBG); }
            if ( COBpredBGs.length < 48 ) { COBpredBGs.push(COBpredBG); }
            if ( UAMpredBGs.length < 48 ) { UAMpredBGs.push(UAMpredBG); }
            if ( ZTpredBGs.length < 48 ) { ZTpredBGs.push(ZTpredBG); }
            // calculate minGuardBGs without a wait from COB, UAM, IOB predBGs
            if ( COBpredBG < minCOBGuardBG ) { minCOBGuardBG = round(COBpredBG); }
            if ( UAMpredBG < minUAMGuardBG ) { minUAMGuardBG = round(UAMpredBG); }
            if ( IOBpredBG < minIOBGuardBG ) { minIOBGuardBG = round(IOBpredBG); }
            if ( ZTpredBG < minZTGuardBG ) { minZTGuardBG = round(ZTpredBG); }

            // set minPredBGs starting when currently-dosed insulin activity will peak
            // look ahead 60m (regardless of insulin type) so as to be less aggressive on slower insulins
            var insulinPeakTime = 60;
            // add 30m to allow for insulin delivery (SMBs or temps)
            insulinPeakTime = 90;
            var insulinPeak5m = (insulinPeakTime/60)*12;
            //console.error(insulinPeakTime, insulinPeak5m, profile.insulinPeakTime, profile.curve);

            // wait 90m before setting minIOBPredBG
            if ( IOBpredBGs.length > insulinPeak5m && (IOBpredBG < minIOBPredBG) ) { minIOBPredBG = round(IOBpredBG); }
            if ( IOBpredBG > maxIOBPredBG ) { maxIOBPredBG = IOBpredBG; }
            // wait 85-105m before setting COB and 60m for UAM minPredBGs
            if ( (cid || remainingCIpeak > 0) && COBpredBGs.length > insulinPeak5m && (COBpredBG < minCOBPredBG) ) { minCOBPredBG = round(COBpredBG); }
            if ( (cid || remainingCIpeak > 0) && COBpredBG > maxIOBPredBG ) { maxCOBPredBG = COBpredBG; }
            if ( enableUAM && UAMpredBGs.length > 12 && (UAMpredBG < minUAMPredBG) ) { minUAMPredBG = round(UAMpredBG); }
            if ( enableUAM && UAMpredBG > maxIOBPredBG ) { maxUAMPredBG = UAMpredBG; }
        });
        // set eventualBG to include effect of carbs
        //console.error("PredBGs:",JSON.stringify(predBGs));
    } catch (e) {
        console.error("Problem with iobArray.  Optional feature Advanced Meal Assist disabled");
    }
    if (meal_data.mealCOB) {
        console.error("predCIs (mg/dL/5m):" + predCIs.join(" "));
        console.error("remainingCIs:      " + remainingCIs.join(" "));
    }
    rT.predBGs = {};
    IOBpredBGs.forEach(function(p, i, theArray) {
        theArray[i] = round(Math.min(401,Math.max(39,p)));
    });
    for (var i=IOBpredBGs.length-1; i > 12; i--) {

        if (IOBpredBGs[i-1] !== IOBpredBGs[i]) { break; }
        else { IOBpredBGs.pop(); }
    }
    rT.predBGs.IOB = IOBpredBGs;
    lastIOBpredBG=round(IOBpredBGs[IOBpredBGs.length-1]);
    ZTpredBGs.forEach(function(p, i, theArray) {
        theArray[i] = round(Math.min(401,Math.max(39,p)));
    });
    for (i=ZTpredBGs.length-1; i > 6; i--) {
        // stop displaying ZTpredBGs once they're rising and above target
        if (ZTpredBGs[i-1] >= ZTpredBGs[i] || ZTpredBGs[i] <= target_bg) { break; }
        else { ZTpredBGs.pop(); }
    }
    rT.predBGs.ZT = ZTpredBGs;
    lastZTpredBG=round(ZTpredBGs[ZTpredBGs.length-1]);
    if (meal_data.mealCOB > 0 && ( ci > 0 || remainingCIpeak > 0 )) {
        COBpredBGs.forEach(function(p, i, theArray) {
            theArray[i] = round(Math.min(1500,Math.max(39,p)));
        });
        for (i=COBpredBGs.length-1; i > 12; i--) {
            if (COBpredBGs[i-1] !== COBpredBGs[i]) { break; }
            else { COBpredBGs.pop(); }
        }
        rT.predBGs.COB = COBpredBGs;
        lastCOBpredBG=round(COBpredBGs[COBpredBGs.length-1]);
        eventualBG = Math.max(eventualBG, round(COBpredBGs[COBpredBGs.length-1]));
        console.error("COBpredBG: " + round(COBpredBGs[COBpredBGs.length-1]) );
    }
    if (ci > 0 || remainingCIpeak > 0) {
        if (enableUAM) {
            UAMpredBGs.forEach(function(p, i, theArray) {
                theArray[i] = round(Math.min(401,Math.max(39,p)));
            });
            for (i=UAMpredBGs.length-1; i > 12; i--) {
                if (UAMpredBGs[i-1] !== UAMpredBGs[i]) { break; }
                else { UAMpredBGs.pop(); }
            }
            rT.predBGs.UAM = UAMpredBGs;
            lastUAMpredBG=round(UAMpredBGs[UAMpredBGs.length-1]);
            if (UAMpredBGs[UAMpredBGs.length-1]) {
                eventualBG = Math.max(eventualBG, round(UAMpredBGs[UAMpredBGs.length-1]) );
            }
        }

        // set eventualBG based on COB or UAM predBGs
        rT.eventualBG = eventualBG;
    }

    console.error("UAM Impact:" + uci + "mg/dL per 5m; UAM Duration:" + UAMduration + "hours");

    minIOBPredBG = Math.max(39,minIOBPredBG);
    minCOBPredBG = Math.max(39,minCOBPredBG);
    minUAMPredBG = Math.max(39,minUAMPredBG);
    minPredBG = round(minIOBPredBG);

    var fractionCarbsLeft = meal_data.mealCOB/meal_data.carbs;
    // if we have COB and UAM is enabled, average both
    if ( minUAMPredBG < 999 && minCOBPredBG < 999 ) {
        // weight COBpredBG vs. UAMpredBG based on how many carbs remain as COB
        avgPredBG = round( (1-fractionCarbsLeft)*UAMpredBG + fractionCarbsLeft*COBpredBG );
        // if UAM is disabled, average IOB and COB
    } else if ( minCOBPredBG < 999 ) {
        avgPredBG = round( (IOBpredBG + COBpredBG)/2 );
        // if we have UAM but no COB, average IOB and UAM
    } else if ( minUAMPredBG < 999 ) {
        avgPredBG = round( (IOBpredBG + UAMpredBG)/2 );
    } else {
        avgPredBG = round( IOBpredBG );
    }
    // if avgPredBG is below minZTGuardBG, bring it up to that level
    if ( minZTGuardBG > avgPredBG ) {
        avgPredBG = minZTGuardBG;
    }

    // if we have both minCOBGuardBG and minUAMGuardBG, blend according to fractionCarbsLeft
    if ( (cid || remainingCIpeak > 0) ) {
        if ( enableUAM ) {
            minGuardBG = fractionCarbsLeft*minCOBGuardBG + (1-fractionCarbsLeft)*minUAMGuardBG;
        } else {
            minGuardBG = minCOBGuardBG;
        }
    } else if ( enableUAM ) {
        minGuardBG = minUAMGuardBG;
    } else {
        minGuardBG = minIOBGuardBG;
    }
    minGuardBG = round(minGuardBG);
    //console.error(minCOBGuardBG, minUAMGuardBG, minIOBGuardBG, minGuardBG);

    var minZTUAMPredBG = minUAMPredBG;
    // if minZTGuardBG is below threshold, bring down any super-high minUAMPredBG by averaging
    // this helps prevent UAM from giving too much insulin in case absorption falls off suddenly
    if ( minZTGuardBG < threshold ) {
        minZTUAMPredBG = (minUAMPredBG + minZTGuardBG) / 2;
    // if minZTGuardBG is between threshold and target, blend in the averaging
    } else if ( minZTGuardBG < target_bg ) {
        // target 100, threshold 70, minZTGuardBG 85 gives 50%: (85-70) / (100-70)
        var blendPct = (minZTGuardBG-threshold) / (target_bg-threshold);
        var blendedMinZTGuardBG = minUAMPredBG*blendPct + minZTGuardBG*(1-blendPct);
        minZTUAMPredBG = (minUAMPredBG + blendedMinZTGuardBG) / 2;
        //minZTUAMPredBG = minUAMPredBG - target_bg + minZTGuardBG;
    // if minUAMPredBG is below minZTGuardBG, bring minUAMPredBG up by averaging
    // this allows more insulin if lastUAMPredBG is below target, but minZTGuardBG is still high
    } else if ( minZTGuardBG > minUAMPredBG ) {
        minZTUAMPredBG = (minUAMPredBG + minZTGuardBG) / 2;
    }
    minZTUAMPredBG = round(minZTUAMPredBG);
    //console.error("minUAMPredBG:",minUAMPredBG,"minZTGuardBG:",minZTGuardBG,"minZTUAMPredBG:",minZTUAMPredBG);
    // if any carbs have been entered recently
    if (meal_data.carbs) {

        // if UAM is disabled, use max of minIOBPredBG, minCOBPredBG
        if ( ! enableUAM && minCOBPredBG < 999 ) {
            minPredBG = round(Math.max(minIOBPredBG, minCOBPredBG));
        // if we have COB, use minCOBPredBG, or blendedMinPredBG if it's higher
        } else if ( minCOBPredBG < 999 ) {
            // calculate blendedMinPredBG based on how many carbs remain as COB
            var blendedMinPredBG = fractionCarbsLeft*minCOBPredBG + (1-fractionCarbsLeft)*minZTUAMPredBG;
            // if blendedMinPredBG > minCOBPredBG, use that instead
            minPredBG = round(Math.max(minIOBPredBG, minCOBPredBG, blendedMinPredBG));
        // if carbs have been entered, but have expired, use minUAMPredBG
        } else if ( enableUAM ) {
            minPredBG = minZTUAMPredBG;
        } else {
            minPredBG = minGuardBG;
        }
    // in pure UAM mode, use the higher of minIOBPredBG,minUAMPredBG
    } else if ( enableUAM ) {
        minPredBG = round(Math.max(minIOBPredBG,minZTUAMPredBG));
    }

    // make sure minPredBG isn't higher than avgPredBG
    minPredBG = Math.min( minPredBG, avgPredBG );

// Print summary variables based on predBGs etc.

    process.stderr.write("minPredBG: "+minPredBG+" minIOBPredBG: "+minIOBPredBG+" minZTGuardBG: "+minZTGuardBG);
    if (minCOBPredBG < 999) {
        process.stderr.write(" minCOBPredBG: "+minCOBPredBG);
    }
    if (minUAMPredBG < 999) {
        process.stderr.write(" minUAMPredBG: "+minUAMPredBG);
    }
    console.error(" avgPredBG:" + avgPredBG + " COB/Carbs:" + meal_data.mealCOB + "/" + meal_data.carbs);
    // But if the COB line falls off a cliff, don't trust UAM too much:
    // use maxCOBPredBG if it's been set and lower than minPredBG
    if ( maxCOBPredBG > bg ) {
        minPredBG = Math.min(minPredBG, maxCOBPredBG);
    }

    rT.COB=meal_data.mealCOB;
    rT.IOB=iob_data.iob;
    rT.BGI=convert_bg(bgi,profile);
    rT.deviation=convert_bg(deviation, profile);
    rT.ISF=convert_bg(sens, profile);
    rT.CR=round(carbRatio, 1);
    rT.target_bg=convert_bg(target_bg, profile);
    rT.TDD=round(tdd_before, 2);
    rT.current_target=round(target_bg, 0);

    var cr_log = rT.CR;
    if (cr_before != rT.CR) {
        cr_log = cr_before + "\u2192" + rT.CR;
    }

    rT.reason = isfreason + ", COB: " + rT.COB + ", Dev: " + rT.deviation + ", BGI: " + rT.BGI + ", CR: " + cr_log + ", Target: " + targetLog + ", minPredBG " + convert_bg(minPredBG, profile) + ", minGuardBG " + convert_bg(minGuardBG, profile) + ", IOBpredBG " + convert_bg(lastIOBpredBG, profile);
    if (lastCOBpredBG > 0) {
        rT.reason += ", COBpredBG " + convert_bg(lastCOBpredBG, profile);
    }
    if (lastUAMpredBG > 0) {
        rT.reason += ", UAMpredBG " + convert_bg(lastUAMpredBG, profile);
    }
    rT.reason += tddReason;

    //If SMB delivery ratio is other than default 0.5
    if (profile.smb_delivery_ratio != 0.5) {
        rT.reason += ", SMB Ratio: " + profile.smb_delivery_ratio;
    }

    rT.reason += "; "; // reason.conclusion started
// Use minGuardBG to prevent overdosing in hypo-risk situations
    // use naive_eventualBG if above 40, but switch to minGuardBG if both eventualBGs hit floor of 39
    var carbsReqBG = naive_eventualBG;
    if ( carbsReqBG < 40 ) {
        carbsReqBG = Math.min( minGuardBG, carbsReqBG );
    }
    var bgUndershoot = threshold - carbsReqBG;
    // calculate how long until COB (or IOB) predBGs drop below min_bg
    var minutesAboveMinBG = 240;
    var minutesAboveThreshold = 240;
    if (meal_data.mealCOB > 0 && ( ci > 0 || remainingCIpeak > 0 )) {
        for (i=0; i<COBpredBGs.length; i++) {
            if ( COBpredBGs[i] < min_bg ) {
                minutesAboveMinBG = 5*i;
                break;
            }
        }
        for (i=0; i<COBpredBGs.length; i++) {
            if ( COBpredBGs[i] < threshold ) {
                minutesAboveThreshold = 5*i;
                break;
            }
        }
    }

    else {
        for (i=0; i<IOBpredBGs.length; i++) {
            //console.error(IOBpredBGs[i], min_bg);
            if ( IOBpredBGs[i] < min_bg ) {
                minutesAboveMinBG = 5*i;
                break;
            }
        }
        for (i=0; i<IOBpredBGs.length; i++) {
            //console.error(IOBpredBGs[i], threshold);
            if ( IOBpredBGs[i] < threshold ) {
                minutesAboveThreshold = 5*i;
                break;
            }
        }
    }

    if (enableSMB && minGuardBG < threshold) {
        console.error("minGuardBG " + convert_bg(minGuardBG, profile) + " projected below " + convert_bg(threshold, profile) + " - disabling SMB");
        rT.manualBolusErrorString = 1;
        rT.minGuardBG = minGuardBG;
        rT.insulinForManualBolus = round((rT.eventualBG - rT.target_bg) / sens, 2);

        //rT.reason += "minGuardBG "+minGuardBG+"<"+threshold+": SMB disabled; ";
        enableSMB = false;
    }
// Disable SMB for sudden rises (often caused by calibrations or activation/deactivation of Dexcom's noise-filtering algorithm)
// Added maxDelta_bg_threshold as a hidden preference and included a cap at 0.4 as a safety limitLog
var maxDelta_bg_threshold;
    if (typeof profile.maxDelta_bg_threshold === 'undefined') {
        maxDelta_bg_threshold = 0.2;
    }
    if (typeof profile.maxDelta_bg_threshold !== 'undefined') {
        maxDelta_bg_threshold = Math.min(profile.maxDelta_bg_threshold, 0.4);
    }
    if ( maxDelta > maxDelta_bg_threshold * bg ) {
        console.error("maxDelta " + convert_bg(maxDelta, profile)+ " > " + 100 * maxDelta_bg_threshold + "% of BG " + convert_bg(bg, profile) + " - disabling SMB");
        rT.reason += "maxDelta " + convert_bg(maxDelta, profile) + " > " + 100 * maxDelta_bg_threshold + "% of BG " + convert_bg(bg, profile) + " - SMB disabled!, ";
        enableSMB = false;
    }

// Calculate carbsReq (carbs required to avoid a hypo)
    console.error("BG projected to remain above " + convert_bg(min_bg, profile) + " for " + minutesAboveMinBG + "minutes");
    if ( minutesAboveThreshold < 240 || minutesAboveMinBG < 60 ) {
        console.error("BG projected to remain above " + convert_bg(threshold,profile) + " for " + minutesAboveThreshold + "minutes");
    }
    // include at least minutesAboveThreshold worth of zero temps in calculating carbsReq
    // always include at least 30m worth of zero temp (carbs to 80, low temp up to target)
    var zeroTempDuration = minutesAboveThreshold;
    // BG undershoot, minus effect of zero temps until hitting min_bg, converted to grams, minus COB
    var zeroTempEffect = profile.current_basal*overrideFactor*sens*zeroTempDuration/60;
    // don't count the last 25% of COB against carbsReq
    var COBforCarbsReq = Math.max(0, meal_data.mealCOB - 0.25*meal_data.carbs);
    var carbsReq = (bgUndershoot - zeroTempEffect) / csf - COBforCarbsReq;
    zeroTempEffect = round(zeroTempEffect);
    carbsReq = round(carbsReq);
    console.error("naive_eventualBG:",naive_eventualBG,"bgUndershoot:",bgUndershoot,"zeroTempDuration:",zeroTempDuration,"zeroTempEffect:",zeroTempEffect,"carbsReq:",carbsReq);
    if ( meal_data.reason == "Could not parse clock data" ) {
        console.error("carbsReq unknown: Could not parse clock data");
    } else if ( carbsReq >= profile.carbsReqThreshold && minutesAboveThreshold <= 45 ) {
        rT.carbsReq = carbsReq;
        rT.reason += carbsReq + " add'l carbs req w/in " + minutesAboveThreshold + "m; ";
    }

// Begin core dosing logic: check for situations requiring low or high temps, and return appropriate temp after first match

    // don't low glucose suspend if IOB is already super negative and BG is rising faster than predicted
    var worstCaseInsulinReq = 0;
    var durationReq = 0;
    if (bg < threshold && iob_data.iob < -profile.current_basal*overrideFactor*20/60 && minDelta > 0 && minDelta > expectedDelta) {
        rT.reason += "IOB "+iob_data.iob+" < " + round(-profile.current_basal*overrideFactor*20/60,2);
        rT.reason += " and minDelta " + convert_bg(minDelta, profile) + " > " + "expectedDelta " + convert_bg(expectedDelta, profile) + "; ";
     // predictive low glucose suspend mode: BG is / is projected to be < threshold
    } else if ( bg < threshold || minGuardBG < threshold ) {
        rT.reason += "minGuardBG " + convert_bg(minGuardBG, profile) + "<" + convert_bg(threshold, profile);
        bgUndershoot = target_bg - minGuardBG;

        if (minGuardBG < threshold) {
            rT.manualBolusErrorString = 2;
            rT.minGuardBG = minGuardBG;
        }
        rT.insulinForManualBolus =  round((eventualBG - target_bg) / sens, 2);

        worstCaseInsulinReq = bgUndershoot / sens;
        durationReq = round(60*worstCaseInsulinReq / profile.current_basal*overrideFactor);
        durationReq = round(durationReq/30)*30;
        // always set a 30-120m zero temp (oref0-pump-loop will let any longer SMB zero temp run)
        durationReq = Math.min(120,Math.max(30,durationReq));
        return tempBasalFunctions.setTempBasal(0, durationReq, profile, rT, currenttemp);
    }

    // if not in LGS mode, cancel temps before the top of the hour to reduce beeping/vibration
    // console.error(profile.skip_neutral_temps, rT.deliverAt.getMinutes());
    if ( profile.skip_neutral_temps && rT.deliverAt.getMinutes() >= 55 ) {
        rT.reason += "; Canceling temp at " + rT.deliverAt.getMinutes() + "m past the hour. ";
        return tempBasalFunctions.setTempBasal(0, 0, profile, rT, currenttemp);
    }

    var insulinReq = 0;
    var rate = basal;
    var insulinScheduled = 0;
    if (eventualBG < min_bg) { // if eventual BG is below target:
        rT.reason += "Eventual BG " + convert_bg(eventualBG, profile) + " < " + convert_bg(min_bg, profile);
        // if 5m or 30m avg BG is rising faster than expected delta
        if ( minDelta > expectedDelta && minDelta > 0 && !carbsReq ) {
            // if naive_eventualBG < 40, set a 30m zero temp (oref0-pump-loop will let any longer SMB zero temp run)
            if (naive_eventualBG < 40) {
                rT.reason += ", naive_eventualBG < 40. ";
                return tempBasalFunctions.setTempBasal(0, 30, profile, rT, currenttemp);
            }
            if (glucose_status.delta > minDelta) {
                rT.reason += ", but Delta " + convert_bg(tick, profile) + " > expectedDelta " + convert_bg(expectedDelta, profile);
            } else {
                rT.reason += ", but Min. Delta " + minDelta.toFixed(2) + " > Exp. Delta " + convert_bg(expectedDelta, profile);
            }
            if (currenttemp.duration > 15 && (round_basal(basal, profile) === round_basal(currenttemp.rate, profile))) {
                rT.reason += ", temp " + currenttemp.rate + " ~ req " + basal + "U/hr. ";
                return rT;
            } else {
                rT.reason += "; setting current basal of " + basal + " as temp. ";
                return tempBasalFunctions.setTempBasal(basal, 30, profile, rT, currenttemp);
            }
        }

        // calculate 30m low-temp required to get projected BG up to target
        // multiply by 2 to low-temp faster for increased hypo safety
        insulinReq = 2 * Math.min(0, (eventualBG - target_bg) / sens);
        insulinReq = round( insulinReq , 2);
        // calculate naiveInsulinReq based on naive_eventualBG
        var naiveInsulinReq = Math.min(0, (naive_eventualBG - target_bg) / sens);
        naiveInsulinReq = round( naiveInsulinReq , 2);
        if (minDelta < 0 && minDelta > expectedDelta) {
            // if we're barely falling, newinsulinReq should be barely negative
            var newinsulinReq = round(( insulinReq * (minDelta / expectedDelta) ), 2);
            //console.error("Increasing insulinReq from " + insulinReq + " to " + newinsulinReq);
            insulinReq = newinsulinReq;
        }
        // rate required to deliver insulinReq less insulin over 30m:
        rate = basal + (2 * insulinReq);
        rate = round_basal(rate, profile);

        // if required temp < existing temp basal
        insulinScheduled = currenttemp.duration * (currenttemp.rate - basal) / 60;
        // if current temp would deliver a lot (30% of basal) less than the required insulin,
        // by both normal and naive calculations, then raise the rate
        var minInsulinReq = Math.min(insulinReq,naiveInsulinReq);

        console.log("naiveInsulinReq:" + naiveInsulinReq);

        if (insulinScheduled < minInsulinReq - basal*0.3) {
            rT.reason += ", " + currenttemp.duration + "m@" + (currenttemp.rate).toFixed(2) + " is a lot less than needed. ";
            return tempBasalFunctions.setTempBasal(rate, 30, profile, rT, currenttemp);
        }
        if (typeof currenttemp.rate !== 'undefined' && (currenttemp.duration > 5 && rate >= currenttemp.rate * 0.8)) {
            rT.reason += ", temp " + currenttemp.rate + " ~< req " + rate + "U/hr. ";
            return rT;
        }

        else {
            // calculate a long enough zero temp to eventually correct back up to target
            if ( rate <=0 ) {
                bgUndershoot = target_bg - naive_eventualBG;
                worstCaseInsulinReq = bgUndershoot / sens;
                durationReq = round(60*worstCaseInsulinReq / profile.current_basal * overrideFactor);
                if (durationReq < 0) {
                    durationReq = 0;
                // don't set a temp longer than 120 minutes
                } else {
                    durationReq = round(durationReq/30)*30;
                    durationReq = Math.min(120,Math.max(0,durationReq));
                }
                //console.error(durationReq);
                if (durationReq > 0) {
                    rT.reason += ", setting " + durationReq + "m zero temp. ";
                    return tempBasalFunctions.setTempBasal(rate, durationReq, profile, rT, currenttemp);
                }
            }

            else {
                rT.reason += ", setting " + rate + "U/hr. ";
            }
            return tempBasalFunctions.setTempBasal(rate, 30, profile, rT, currenttemp);
        }
    }

    // if eventual BG is above min_bg but BG is falling faster than expected Delta
    if (minDelta < expectedDelta) {

        rT.minDelta = minDelta;
        rT.expectedDelta = expectedDelta;

        //Describe how the glucose is changing
        if (expectedDelta - minDelta >= 2 || (expectedDelta + (-1 * minDelta) >= 2)) {
            if (minDelta >= 0 && expectedDelta > 0) {
                rT.manualBolusErrorString = 3;
            }
            else if ((minDelta < 0 && expectedDelta <= 0) ||  (minDelta < 0 && expectedDelta >= 0)) {
                rT.manualBolusErrorString = 4;
            }
            else {
                rT.manualBolusErrorString = 5;
            }
        }

        rT.insulinForManualBolus = round((rT.eventualBG - rT.target_bg) / sens, 2);

        // if in SMB mode, don't cancel SMB zero temp
        if (! (microBolusAllowed && enableSMB)) {
            if (glucose_status.delta < minDelta) {
                rT.reason += "Eventual BG " + convert_bg(eventualBG, profile) + " > " + convert_bg(min_bg, profile) + " but Delta " + convert_bg(tick, profile) + " < Exp. Delta " + convert_bg(expectedDelta, profile);
            } else {
                rT.reason += "Eventual BG " + convert_bg(eventualBG, profile) + " > " + convert_bg(min_bg, profile) + " but Min. Delta " + minDelta.toFixed(2) + " < Exp. Delta " + convert_bg(expectedDelta, profile);
            }
            if (currenttemp.duration > 15 && (round_basal(basal, profile) === round_basal(currenttemp.rate, profile))) {
                rT.reason += ", temp " + currenttemp.rate + " ~ req " + basal + "U/hr. ";
                return rT;
            } else {
                rT.reason += "; setting current basal of " + basal + " as temp. ";
                return tempBasalFunctions.setTempBasal(basal, 30, profile, rT, currenttemp);
            }
        }
    }
    // eventualBG or minPredBG is below max_bg
    if (Math.min(eventualBG,minPredBG) < max_bg) {
        if (minPredBG < min_bg && eventualBG > min_bg) {
            rT.manualBolusErrorString = 6;
            rT.insulinForManualBolus = round((rT.eventualBG - rT.target_bg) / sens, 2);
            rT.minPredBG = minPredBG;
        }
        // if in SMB mode, don't cancel SMB zero temp
        if (! (microBolusAllowed && enableSMB )) {
            rT.reason += convert_bg(eventualBG, profile)+ "-" + convert_bg(minPredBG, profile) + " in range: no temp required";
            if (currenttemp.duration > 15 && (round_basal(basal, profile) === round_basal(currenttemp.rate, profile))) {
                rT.reason += ", temp " + currenttemp.rate + " ~ req " + basal + "U/hr. ";
                return rT;
            } else {
                rT.reason += "; setting current basal of " + basal + " as temp. ";
                return tempBasalFunctions.setTempBasal(basal, 30, profile, rT, currenttemp);
            }
        }
    }

    // eventual BG is at/above target
    // if iob is over max, just cancel any temps
    if ( eventualBG >= max_bg ) {
        rT.reason += "Eventual BG " + convert_bg(eventualBG, profile) + " >= " +  convert_bg(max_bg, profile) + ", ";
        if (eventualBG > max_bg) {
        rT.insulinForManualBolus = round((eventualBG - target_bg) / sens, 2);
        }
    }
    if (iob_data.iob > max_iob) {
        rT.reason += "IOB " + round(iob_data.iob,2) + " > max_iob " + max_iob;
        if (currenttemp.duration > 15 && (round_basal(basal, profile) === round_basal(currenttemp.rate, profile))) {
            rT.reason += ", temp " + currenttemp.rate + " ~ req " + basal + "U/hr. ";
            return rT;
        } else {
            rT.reason += "; setting current basal of " + basal + " as temp. ";
            return tempBasalFunctions.setTempBasal(basal, 30, profile, rT, currenttemp);
        }
    }

    else { // otherwise, calculate 30m high-temp required to get projected BG down to target
        // insulinReq is the additional insulin required to get minPredBG down to target_bg
        //console.error(minPredBG,eventualBG);
        insulinReq = round( (Math.min(minPredBG,eventualBG) - target_bg) / sens, 2);
        insulinForManualBolus = round((eventualBG - target_bg) / sens, 2);
        // if that would put us over max_iob, then reduce accordingly
        if (insulinReq > max_iob-iob_data.iob) {
            console.error("SMB limited by maxIOB: " + max_iob-iob_data.iob + " (. insulinReq: " + insulinReq + " U)");
            rT.reason += "max_iob " + max_iob + ", ";
            insulinReq = max_iob-iob_data.iob;
        } else { console.error("SMB not limited by maxIOB ( insulinReq: " + insulinReq + " U).");}

        if (insulinForManualBolus > max_iob-iob_data.iob) {
            console.error("Ev. Bolus limited by maxIOB: " + max_iob-iob_data.iob + " (. insulinForManualBolus: " + insulinForManualBolus + " U)");
            rT.reason += "max_iob " + max_iob + ", ";
        } else { console.error("Ev. Bolus would not be limited by maxIOB ( insulinForManualBolus: " + insulinForManualBolus + " U).");}

        // rate required to deliver insulinReq more insulin over 30m:
        rate = basal + (2 * insulinReq);
        rate = round_basal(rate, profile);
        insulinReq = round(insulinReq,3);
        rT.insulinReq = insulinReq;
        //console.error(iob_data.lastBolusTime);
        // minutes since last bolus
        var lastBolusAge = round(( new Date(systemTime).getTime() - iob_data.lastBolusTime ) / 60000,1);
        //console.error(lastBolusAge);
        //console.error(profile.temptargetSet, target_bg, rT.COB);
        // only allow microboluses with COB or low temp targets, or within DIA hours of a bolus
        if (microBolusAllowed && enableSMB && bg > threshold) {
            // never bolus more than maxSMBBasalMinutes worth of basal


            var smbMinutesSetting =  30;
            if (typeof profile.maxSMBBasalMinutes !== 'undefined') {
                smbMinutesSetting = profile.maxSMBBasalMinutes;
            }
            var uamMinutesSetting = 30;
            if (typeof profile.maxUAMSMBBasalMinutes !== 'undefined') {
                uamMinutesSetting = profile.maxUAMSMBBasalMinutes;
            }

            if (oref2_variables.useOverride && advancedSettings && smbMinutes !== smbMinutesSetting) {
                console.error("SMB Max Minutes - setting overriden from " + smbMinutesSetting + " to " + smbMinutes);
                smbMinutesSetting = smbMinutes;
            }
            if (oref2_variables.useOverride && advancedSettings && uamMinutes !== uamMinutesSetting) {
                console.error("UAM Max Minutes - setting overriden from " + uamMinutesSetting + " to " + uamMinutes);
                uamMinutesSetting = uamMinutes;
            }

            var mealInsulinReq = round( meal_data.mealCOB / carbRatio ,3);
            var maxBolus = 0;
            if (typeof smbMinutesSetting === 'undefined' ) {
                maxBolus = round(profile.current_basal *overrideFactor * 30 / 60 ,1);
                console.error("smbMinutesSetting undefined: defaulting to 30m");

                if( insulinReq > maxBolus ) {
                  console.error("SMB limited by maxBolus: " + maxBolus + " ( " + insulinReq + " U)");
                }
            } else if ( iob_data.iob > mealInsulinReq && iob_data.iob > 0 ) {
                console.error("IOB" + iob_data.iob + "> COB" + meal_data.mealCOB + "; mealInsulinReq =" + mealInsulinReq);
                if (uamMinutesSetting) {
                    console.error("maxUAMSMBBasalMinutes: " + uamMinutesSetting + ", profile.current_basal: " + profile.current_basal * overrideFactor);
                    maxBolus = round(profile.current_basal * overrideFactor * uamMinutesSetting / 60 ,1);
                } else {
                    console.error("maxUAMSMBBasalMinutes undefined: defaulting to 30m");
                    maxBolus = round( profile.current_basal  * overrideFactor * 30 / 60 ,1);
                }
                if( insulinReq > maxBolus ) {
                  console.error("SMB limited by maxUAMSMBBasalMinutes [ " + uamMinutesSetting + "m ]: " + maxBolus + "U ( " + insulinReq + "U )");
                } else { console.error("SMB is not limited by maxUAMSMBBasalMinutes. ( insulinReq: " + insulinReq + "U )"); }
            } else {
                console.error(".maxSMBBasalMinutes: " + smbMinutesSetting + ", profile.current_basal: " + profile.current_basal * overrideFactor);
                maxBolus = round(profile.current_basal * smbMinutesSetting / 60 ,1);

                if( insulinReq > maxBolus ) {
                  console.error("SMB limited by maxSMBBasalMinutes: " + smbMinutesSetting + "m ]: " + maxBolus + "U ( insulinReq: " + insulinReq + "U )");
                } else { console.error("SMB is not limited by maxSMBBasalMinutes. ( insulinReq: " + insulinReq + "U )"); }
            }
            // bolus 1/2 the insulinReq, up to maxBolus, rounding down to nearest bolus increment
            var bolusIncrement = profile.bolus_increment;
            //if (profile.bolus_increment) { bolusIncrement=profile.bolus_increment };
            var roundSMBTo = 1 / bolusIncrement;

            var smb_ratio = profile.smb_delivery_ratio;

            if (smb_ratio > 0.5) {
                console.error("SMB Delivery Ratio increased from default 0.5 to " + round(smb_ratio,2))
            }
            var microBolus = Math.min(insulinReq*smb_ratio, maxBolus);

            microBolus = Math.floor(microBolus*roundSMBTo)/roundSMBTo;
            // calculate a long enough zero temp to eventually correct back up to target
            var smbTarget = target_bg;
            worstCaseInsulinReq = (smbTarget - (naive_eventualBG + minIOBPredBG)/2 ) / sens;
            durationReq = round(60*worstCaseInsulinReq / profile.current_basal * overrideFactor);

            // if insulinReq > 0 but not enough for a microBolus, don't set an SMB zero temp
            if (insulinReq > 0 && microBolus < bolusIncrement) {
                durationReq = 0;
            }

            var smbLowTempReq = 0;
            if (durationReq <= 0) {
                durationReq = 0;
            // don't set an SMB zero temp longer than 60 minutes
            } else if (durationReq >= 30) {
                durationReq = round(durationReq/30)*30;
                durationReq = Math.min(60,Math.max(0,durationReq));
            } else {
                // if SMB durationReq is less than 30m, set a nonzero low temp
                smbLowTempReq = round( basal * durationReq/30 ,2);
                durationReq = 30;
            }
            rT.reason += " insulinReq " + insulinReq;
            if (microBolus >= maxBolus) {
                rT.reason +=  "; maxBolus " + maxBolus;
            }
            if (durationReq > 0) {
                rT.reason += "; setting " + durationReq + "m low temp of " + smbLowTempReq + "U/h";
            }
            rT.reason += ". ";

            //allow SMBs every 3 minutes by default
            var SMBInterval = 3;
            if (profile.SMBInterval) {
                // allow SMBIntervals between 1 and 10 minutes
                SMBInterval = Math.min(10,Math.max(1,profile.SMBInterval));
            }
            var nextBolusMins = round(SMBInterval-lastBolusAge,0);
            var nextBolusSeconds = round((SMBInterval - lastBolusAge) * 60, 0) % 60;
            //console.error(naive_eventualBG, insulinReq, worstCaseInsulinReq, durationReq);
            console.error("naive_eventualBG " + naive_eventualBG + "," + durationReq + "m " + smbLowTempReq + "U/h temp needed; last bolus " + lastBolusAge +"m ago; maxBolus: " + maxBolus);

            if (lastBolusAge > SMBInterval) {
                if (microBolus > 0) {
                    rT.units = microBolus;
                    rT.reason += "Microbolusing " + microBolus + "U. ";
                }
            } else {
                rT.reason += "Waiting " + nextBolusMins + "m " + nextBolusSeconds + "s to microbolus again. ";
            }
            //rT.reason += ". ";

            // if no zero temp is required, don't return yet; allow later code to set a high temp
            if (durationReq > 0) {
                rT.rate = smbLowTempReq;
                rT.duration = durationReq;
                return rT;
            }

        }

        var maxSafeBasal = tempBasalFunctions.getMaxSafeBasal(profile);

        if (rate > maxSafeBasal) {
            rT.reason += "adj. req. rate: " + rate + " to maxSafeBasal: " + round(maxSafeBasal,2) + ", ";
            rate = round_basal(maxSafeBasal, profile);
        }

        insulinScheduled = currenttemp.duration * (currenttemp.rate - basal) / 60;
        if (insulinScheduled >= insulinReq * 2) { // if current temp would deliver >2x more than the required insulin, lower the rate
            rT.reason += currenttemp.duration + "m@" + (currenttemp.rate).toFixed(2) + " > 2 * insulinReq. Setting temp basal of " + rate + "U/hr. ";
            return tempBasalFunctions.setTempBasal(rate, 30, profile, rT, currenttemp);
        }

        if (typeof currenttemp.duration === 'undefined' || currenttemp.duration === 0) { // no temp is set
            rT.reason += "no temp, setting " + rate + "U/hr. ";
            return tempBasalFunctions.setTempBasal(rate, 30, profile, rT, currenttemp);
        }

        if (currenttemp.duration > 5 && (round_basal(rate, profile) <= round_basal(currenttemp.rate, profile))) { // if required temp <~ existing temp basal
            rT.reason += "temp " + currenttemp.rate + " >~ req " + rate + "U/hr. ";
            return rT;
        }

        // required temp > existing temp basal
        rT.reason += "temp " + currenttemp.rate + "<" + rate + "U/hr. ";
        return tempBasalFunctions.setTempBasal(rate, 30, profile, rT, currenttemp);
    }

};

module.exports = determine_basal;
