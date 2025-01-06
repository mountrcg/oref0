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


var round_basal = require('../round-basal');

// Rounds value to 'digits' decimal places
function round(value, digits)
{
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
        return round(value * 0.0555, 1).toFixed(1);
    }
    else
    {
        return Math.round(value);
    }
}

    //*********************************************************************************
    //**                     Start of autoISF3.01 code for predictions              **
    //*********************************************************************************

    //initialize additional autoisf infos for rT.reason
var isfreason = "";
var smbreason = "";
var duraisfreason = "";
var ppisfreason= "";
var deltaisfreason = "";
var transreason = "";
var calcreason = "";
var isfadaptionreason = "";
var fitreason = "";
var withinlimitsreason = "";
var exerciseReason= "";
var TTreason="";
var B30reason="";
var maxIOBreason="";
var autosensReason="";

var acce_ISF = 1;
var bg_ISF = 1;
var delta_ISF = 1;
var pp_ISF = 1;
var dura_ISF = 1;

function enable_smb(
    profile,
    microBolusAllowed,
    meal_data,
    bg,
    target_bg,
    high_bg)
    {
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
            console.error("SMB enabled for COB of" + meal_data.mealCOB);
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
            console.error("SMB enabled for temptarget of",convert_bg(target_bg, profile));
        }
        return true;
    }

    console.error("SMB disabled (no enableSMB preferences active or no condition satisfied)");
    return false;
}

function loop_smb(microBolusAllowed, profile, iob_data, aimismb, useIobTh, iobThEffective, iobTH_reduction_ratio) {
    if ( !microBolusAllowed ) {
        return "oref";                                                  // see message in enable_smb
    }

    // disable SMB when a B30 basal is running
    if (!aimismb) {
        smbreason = ", autoISF-SMB disabled:, B30 running";
        return "AIMI B30";
    }

    if (profile.use_autoisf && profile.enableSMB_EvenOn_OddOff_always)  {
        var target = convert_bg(profile.min_bg, profile);

        if (profile['out_units'] == "mmol/L") {
            evenTarget = ( round(target*10, 0) %2 == 0 );
            msgUnits   = " has ";
            msgTail    = " decimal";
        } else {
            evenTarget = ( target %2 == 0 );
            msgUnits   = " is ";
            msgTail    = " number";
        }
        if ( evenTarget ) {
            msgEven    = "even";
        } else {
            msgEven    = "odd";
        }
        var iobThUser = profile.iob_threshold_percent * 100;
        if ( useIobTh ) {
            var iobThPercent = round(iobThEffective/profile.max_iob*100.0, 0);
            if ( iobThPercent == iobThUser ) {
                console.error("User setting iobTH="+iobThUser+"% not modulated");
            } else {
                console.error("User setting iobTH="+iobThUser+"% modulated to "+round(iobThPercent,1)+"% or "+round(iobThEffective,1)+"U") ;
                console.error("  due to profile %, exercise mode or similar");
            }
        } else {
            console.error("User setting iobTH=100% disables iobTH method")
        }
        if ( !evenTarget ){
            console.error("SMB disabled; current target " + target + msgUnits + msgEven + msgTail);
            console.error("Loop allows minimal power");
            smbreason = ", autoISF-SMB disabled:, odd Target";
            return "blocked";
        } else if ( profile.max_iob==0 ) {
            console.error("SMB disabled because of maxIOB=0")
            return "blocked";
        } else if (useIobTh && iobThEffective < iob_data.iob) {
            console.error("SMB disabled by Full Loop logic: IOB " + iob_data.iob + " is more than " + iobThEffective + "% of maxIOB " + profile.max_iob);
            console.error("Loop power level temporarily capped");
            smbreason = ", autoISF-SMB disabled:, iobTH exceeded";
            console.error("Full Loop capped");
            return "iobTH";
        } else {
            console.error("SMB enabled - current target " +target +msgUnits +msgEven +msgTail);
            if (target < 100) {     // indirect asessment; later set it in GUI
                console.error("iobTH: " + round(iobThEffective,1) + "%, IOB% of maxIOB at " + round(iob_data.iob/(profile.max_iob*iobTH_reduction_ratio)*100,1) + "%")
                console.error("Loop allows maximum power");
                smbreason = ", autoISF-SMB enabled:, even TT";
                return "fullLoop";                                      // even number
            } else {
                console.error("iobTH: " + round(iobThEffective,1) + "%, IOB% of maxIOB at " + round(iob_data.iob/(profile.max_iob*iobTH_reduction_ratio)*100,1) + "%")
                smbreason = ", autoISF-SMB enabled:, even Target";
                console.error("Loop at medium power");
                return "enforced";                                      // even number
            }
        }
    }
    console.error("Full Loop disabled");
    return "oref";                              // leave it to standard oref
}

function interpolate(xdata, profile, type)
{   // interpolate ISF behaviour based on polygons defining nonlinear functions defined by value pairs for ...
    //  ...      <---------------  glucose  ------------------->
    var polyX = [  50,   60,   80,   90, 100, 110, 150, 180, 200];    // later, hand it over
    var polyY = [-0.5, -0.5, -0.3, -0.2, 0.0, 0.0, 0.5, 0.7, 0.7];    // later, hand it over

    var polymax = polyX.length-1;
    var step = polyX[0];
    var sVal = polyY[0];
    var stepT= polyX[polymax];
    var sValold = polyY[polymax];

    var newVal = 1;
    var lowVal = 1;
    var topVal = 1;
    var lowX = 1;
    var topX = 1;
    var myX = 1;
    var lowLabl = step;

    if (step > xdata) {
        // extrapolate backwards
        stepT = polyX[1];
        sValold = polyY[1];
        lowVal = sVal;
        topVal = sValold;
        lowX = step;
        topX = stepT;
        myX = xdata;
        newVal = lowVal + (topVal-lowVal)/(topX-lowX)*(myX-lowX);
    } else if (stepT < xdata) {
        // extrapolate forwards
        step   = polyX[polymax-1];
        sVal   = polyY[polymax-1];
        lowVal = sVal;
        topVal = sValold;
        lowX = step;
        topX = stepT;
        myX = xdata;
        newVal = lowVal + (topVal-lowVal)/(topX-lowX)*(myX-lowX);
    } else {
        // interpolate
        for (var i=0; i <= polymax; i++) {
            step = polyX[i];
            sVal = polyY[i];
            if (step == xdata) {
                newVal = sVal;
                break;
            } else if (step > xdata) {
                topVal = sVal;
                lowX= lowLabl;
                myX = xdata;
                topX= step;
                newVal = lowVal + (topVal-lowVal)/(topX-lowX)*(myX-lowX);
                break;
            }
            lowVal = sVal;
            lowLabl= step;
        }
    }
    if ( xdata>100) {newVal = newVal * profile['higher_ISFrange_weight']}     // higher BG range
    else            {newVal = newVal * profile['lower_ISFrange_weight']}      // lower BG range
    return newVal;
}

function withinISFlimits(liftISF, minISFReduction, maxISFReduction, sensitivityRatio, origin_sens, profile, high_temptarget_raises_sensitivity, target_bg, normalTarget) {

    console.error("check ratio " + round(liftISF,2) + " against autoISF min: " + minISFReduction + " and autoISF max: " + maxISFReduction);
    if ( liftISF < minISFReduction ) {
        withinlimitsreason = " (lmtd.min)";
        isfadaptionreason = "weakest autoISF factor " + round(liftISF,2) + " limited by autoISF_min " + minISFReduction;
        console.error(isfadaptionreason);
        liftISF = minISFReduction;
    } else if ( liftISF > maxISFReduction ) {
        withinlimitsreason = " (lmtd.max)";
        isfadaptionreason = "strongest autoISF factor " + round(liftISF,2) + " limited by autoISF_max " + maxISFReduction;
        console.error(isfadaptionreason);
        liftISF = maxISFReduction;
    }
    var final_ISF = 1;
    if ( high_temptarget_raises_sensitivity && profile.temptargetSet && target_bg > normalTarget ) {
         final_ISF = liftISF * sensitivityRatio;
         origin_sens = " (exerciseMode)";
         console.error("autoISF adjusts sens " + sensitivityRatio + ", instead of profile.sens "  + profile.sens);
         exerciseReason = origin_sens;
    } else if ( liftISF >= 1 ) {
        final_ISF = Math.max(liftISF, sensitivityRatio);
        if (liftISF >= sensitivityRatio) {
            origin_sens = "";                                           // autoISF dominates
        } else {
            origin_sens = "(low TT)";                               // low TT lowers sensitivity dominates
        }
    } else {
        final_ISF = Math.min(liftISF, sensitivityRatio);
        if (liftISF <= sensitivityRatio)
            { origin_sens = "";}        // autoISF dominates
    }
    isfadaptionreason = "final ISF factor " + round(final_ISF,2) + origin_sens // mod V14j
    console.error(isfadaptionreason);
    console.error("----------------------------------");
    console.error("end autoISF");
    console.error("----------------------------------");
    return final_ISF;}

function autoISF(sens, origin_sens, target_bg, profile, glucose_status, meal_data, currentTime, autosens_data, sensitivityRatio, loop_wanted_smb, high_temptarget_raises_sensitivity, normalTarget)
{   // #### mod 7e: added switch for autoISF ON/OFF
    if ( !profile.use_autoisf ) {
        isfreason += ", autoISF disabled";
        console.error("autoISF disabled in Preferences");
        console.error("----------------------------------");
        console.error("end autoISF");
        console.error("----------------------------------");
        return sens;
    }
    if ( profile.autoISF_off_Sport && (profile.high_temptarget_raises_sensitivity || profile.exercise_mode) && profile.temptargetSet && target_bg > normalTarget) {
        isfreason += ", autoISF disabled (exercise)";
        console.error("autoISF disabled due to Exercise");
        console.error("----------------------------------");
        console.error("end autoISF");
        console.error("----------------------------------");
        return sens;
    }

    // mod 14g: append variables for quadratic fit
    const parabola_fit_minutes = glucose_status.dura_p;
    const parabola_fit_last_delta = glucose_status.delta_pl;
    const parabola_fit_next_delta = glucose_status.delta_pn;
    const parabola_fit_correlation = glucose_status.r_squ;
    const parabola_fit_a0 = glucose_status.a_0;
    const parabola_fit_a1 = glucose_status.a_1;
    const parabola_fit_a2 = glucose_status.a_2;
    const dura05 = glucose_status.dura_ISF_minutes;
    const avg05  = glucose_status.dura_ISF_average;
    var minISFReduction = profile.autoISF_min;
    var maxISFReduction = profile.autoISF_max;
    var sens_modified = false;
    var pp_ISF = 1;
    var acce_weight = 1;
    var bg_off = target_bg + 10 - glucose_status.glucose;                      // move from central BG=100 to target+10 as virtual BG'=100
    var autoISFsens = sens;

     // calculate acce_ISF from bg acceleration and adapt ISF accordingly
    var fit_corr = glucose_status.parabola_fit_correlation;
    var bg_acce = glucose_status.bg_acceleration;
    var ppdebug = glucose_status.pp_debug;
    transreason += "bg_acceleration: " + round(bg_acce,3) + ", PF-minutes: " + parabola_fit_minutes + ", PF-corr: " + round(parabola_fit_correlation,4) + ", PF-nextDelta: " + convert_bg(parabola_fit_next_delta,profile) + ", PF-lastDelta: " + convert_bg(parabola_fit_last_delta,profile) +  ", regular Delta: " + convert_bg(glucose_status.delta,profile);
    console.error(ppdebug)
    if  (!profile.enable_BG_acceleration) {
        console.error("autoISF BG-Accelertion adaption disabled in Preferences");
    } else {
        // start of mod V14j: calculate acce_ISF from bg acceleration and adapt ISF accordingly
        var fit_corr = parabola_fit_correlation;
        if (parabola_fit_a2 !=0 && fit_corr>=0.9) {
            var minmax_delta = - parabola_fit_a1/2/parabola_fit_a2 * 5;       // back from 5min block to 1 min
            var minmax_value = round(parabola_fit_a0 - minmax_delta*minmax_delta/25*parabola_fit_a2, 1);
            minmax_delta = round(minmax_delta, 1);
            if (minmax_delta>0 && bg_acce<0) {
                fitreason = "predicts a Max of " + convert_bg(minmax_value,profile) + ", in about " + Math.abs(minmax_delta) + "min";
                console.error("Parabolic fit " + fitreason);
            } else if (minmax_delta>0 && bg_acce>0) {
                fitreason = "predicts a Min of " + convert_bg(minmax_value,profile) + ", in about " + Math.abs(minmax_delta) + "min";
                console.error("Parabolic fit " + fitreason);
                if (minmax_delta<=30 && minmax_value<target_bg) {   // start braking
                    acce_weight = -profile.bgBrake_ISF_weight;
                    fitreason = "predicts BG below target soon, applying bgBrake ISF weight of " + -acce_weight;
                    console.error("Parabolic fit " + fitreason);
                }
            } else if (minmax_delta<0 && bg_acce<0) {
                fitreason = "saw Max of " + convert_bg(minmax_value,profile) + ", about " + Math.abs(minmax_delta) + "min ago";
                console.error("Parabolic fit " + fitreason);
            } else if (minmax_delta<0 && bg_acce>0) {
                fitreason = "saw Min of " + convert_bg(minmax_value,profile) + ", about " + Math.abs(minmax_delta) + "min ago";
                console.error("Parabolic fit " + fitreason);
            }
        }
        if ( fit_corr<0.9 ) {
            fitreason = "acce_ISF by-passed, as correlation, " + round(fit_corr,2) + ", is too low";
            console.error("Parabolic fit " + fitreason);
            calcreason += ", Parabolic Fit:, " + fitreason;
        } else {
            var fit_share = 10*(fit_corr-0.9);                                      // 0 at correlation 0.9, 1 at 1.00
            var cap_weight = 1;                                                     // full contribution above target
            var meal_addon = 0;
            if ( acce_weight==1 && glucose_status.glucose<profile.target_bg ) {     // below target acce goes towards target
                if ( bg_acce > 0 ) {
                    if (bg_acce>1) {cap_weight = 0.5}                           // halve the effect below target
                    acce_weight = profile.bgBrake_ISF_weight;
                } else if ( bg_acce < 0 ) {
                    acce_weight = profile.bgAccel_ISF_weight + meal_addon;
                }
            } else if ( acce_weight==1) {                                       // above target acce goes away from target
                if ( bg_acce < 0 ) {
                    acce_weight = profile.bgBrake_ISF_weight;
                } else if ( bg_acce > 0 ) {
                    acce_weight = profile.bgAccel_ISF_weight + meal_addon;
                }
            }
            acce_ISF = 1 + bg_acce * cap_weight * acce_weight * fit_share;
            if (acce_ISF < 0) {acce_ISF = 0.1};  //no negative acce_ISF ratios
            // calcreason += ", Parabolic Fit, " + fitreason;
            console.error(calcreason + "acce_ISF adaptation is " + round(acce_ISF,2));
            if ( acce_ISF != 1 ) {
                sens_modified = true;
                calcreason += ", Parabolic Fit:, " + fitreason + ", acce-ISF Ratio:, " + round(acce_ISF,2);
            }
        }
    }
    isfreason += smbreason + calcreason + ", autoISF";

    bg_ISF = 1 + interpolate(100-bg_off, profile, "bg");
    console.error("bg_ISF adaptation is " + round(bg_ISF,2));
    var liftISF = 1;
    var final_ISF = 1;
    if (bg_ISF<1) {
        liftISF = Math.min(bg_ISF, acce_ISF);
        if ( acce_ISF>1 ) {
            liftISF = bg_ISF * acce_ISF;    // bg_ISF could become > 1 now
            isfadaptionreason = "bg-ISF adaptation lifted to " + round(liftISF,2) + ", as BG accelerates already";   // mod V14j
            console.error(isfadaptionreason);
            isfreason +=  ", bg-ISF Ratio: " + round(liftISF,2) + "(accel.)";
            } else {isfreason +=  ", bg-ISF Ratio: " + round(liftISF,2) + "(minimal)"}
        final_ISF = withinISFlimits(liftISF, profile.autoISF_min, maxISFReduction, sensitivityRatio, origin_sens, profile, high_temptarget_raises_sensitivity, target_bg, normalTarget);
        autoISFsens = Math.min(720, round(profile.sens / final_ISF, 1));
        //isfreason +=  ", bg-ISF Ratio: " + round(final_ISF,2);
        isfreason += ", final Ratio: " + round(final_ISF,2) + exerciseReason + withinlimitsreason + ", final ISF: " + convert_bg(profile.sens,profile) + "\u2192" + convert_bg(autoISFsens, profile);
        return autoISFsens;
    } else if ( bg_ISF > 1 ) {
        sens_modified = true;
        isfreason +=  ", bg-ISF Ratio: " + round(bg_ISF,2);
    }

    var bg_delta = glucose_status.delta;
    var deltaType = 'pp';

    if (bg_off > 0) {
        console.error(deltaType+"_ISF adaptation by-passed as average glucose < "+target_bg+"+10");
    } else if (glucose_status.short_avgdelta < 0) {
        console.error(deltaType+"_ISF adaptation by-passed as no rise or too short lived");
    } else {
        pp_ISF = 1 + Math.max(0, bg_delta * profile.pp_ISF_weight);
        console.error("pp_ISF adaptation is " + round(pp_ISF,2));
        ppisfreason = ", pp-ISF Ratio: " + round(pp_ISF,2);
        if (pp_ISF != 1) {
            sens_modified = true;
        }
    }

    var weightISF = profile.dura_ISF_weight;
    if (dura05<10) {
        console.error("dura_ISF by-passed; BG is only " + dura05 + "m at level " + avg05);
    } else if (avg05 <= target_bg) {
        console.error("dura_ISF by-passed; avg. glucose " + avg05 + " below target " + convert_bg(target_bg,profile));
    } else {
        // # fight the resistance at high levels
        var dura05_weight = dura05 / 60;
        var avg05_weight = weightISF / target_bg;
        dura_ISF += dura05_weight*avg05_weight*(avg05-target_bg);
        sens_modified = true;
        duraisfreason = ", Duration: " + dura05 + ", Avg: " + convert_bg(avg05,profile) + ", dura-ISF Ratio: " + round(dura_ISF,2);
        console.error("dura_ISF adaptation is " + round(dura_ISF,2) + " because ISF " + sens + " did not do it for " + round(dura05,1) + "m");
    }
    if ( sens_modified ) {
        liftISF = Math.max(dura_ISF, bg_ISF, acce_ISF, pp_ISF);
        console.error("autoISF adaption ratios:");
        console.error("  acce " + round(acce_ISF,2));
        console.error("  pp " + round(pp_ISF,2));
        console.error("  dura " + round(dura_ISF,2));
        console.error("  bg " + round(bg_ISF,2));
        if ( acce_ISF < 1 ) {
            isfadaptionreason = "strongest autoISF factor " + round(liftISF,2) + " weakened to " + round(liftISF*acce_ISF,2) + " as bg decelerates already";
            console.error(isfadaptionreason);
            liftISF = liftISF * acce_ISF;                        // brakes on for otherwise stronger or stable ISF
        }                                                        // brakes on for otherwise stronger or stable ISF
        final_ISF = withinISFlimits(liftISF, profile.autoISF_min, maxISFReduction, sensitivityRatio, origin_sens, profile, high_temptarget_raises_sensitivity, target_bg, normalTarget);
        autoISFsens = round(profile.sens / final_ISF, 1);
        isfreason += ppisfreason + deltaisfreason + duraisfreason + ", final Ratio: " + round(final_ISF,2) + exerciseReason + withinlimitsreason + ", final ISF: " + convert_bg(profile.sens,profile) + "\u2192" + convert_bg(autoISFsens, profile);
        return autoISFsens;
    }
    isfreason += ", not modified"
    console.error("autoISF does not modify");
    console.error("----------------------------------");
    console.error("end autoISF");
    console.error("----------------------------------");
    return autoISFsens;                                         // nothing changed
}

function determine_varSMBratio(profile, bg, target_bg, loop_wanted_smb)
{   // let SMB delivery ratio increase f#rom min to max depending on how much bg exceeds target
if ( !profile.use_autoisf ) {
    console.error("autoISF disabled, don't adjust SMB Delivery Ratio");
    return 0.5}
    var smb_delivery_ratio_bg_range = profile.smb_delivery_ratio_bg_range;
    if ( smb_delivery_ratio_bg_range<10 )   { smb_delivery_ratio_bg_range = smb_delivery_ratio_bg_range / 0.0555 }  // was in mmol/l
    var fix_SMB = profile.smb_delivery_ratio;
    var lower_SMB = Math.min(profile.smb_delivery_ratio_min, profile.smb_delivery_ratio_max);
    var higher_SMB = Math.max(profile.smb_delivery_ratio_min, profile.smb_delivery_ratio_max);
    var higher_bg = target_bg + smb_delivery_ratio_bg_range;
    var new_SMB = fix_SMB;

    if ( smb_delivery_ratio_bg_range > 0 ) {
        new_SMB = lower_SMB + (higher_SMB-lower_SMB)*(bg-target_bg) / smb_delivery_ratio_bg_range;
        new_SMB = Math.max(lower_SMB, Math.min(higher_SMB, new_SMB))            // cap if outside target_bg--higher_bg
    }
    if ( loop_wanted_smb=='fullLoop' ) {                                // go for max impact
        console.error('SMB delivery ratio set to ' + round(Math.max(fix_SMB, new_SMB),2) + ' as max of fixed and interpolated values');
        return Math.max(fix_SMB, new_SMB);
    }
    if ( smb_delivery_ratio_bg_range==0 ) {                     // deactivated in SMB extended menu
        console.error('SMB delivery ratio set to fixed value ' + round(fix_SMB,2));
        return fix_SMB;
    }
    if (bg <= target_bg) {
        console.error('SMB delivery ratio limited by minimum value ' + round(lower_SMB,2));
        return lower_SMB;
    }
    if (bg >= higher_bg) {
        console.error('SMB delivery ratio limited by maximum value ' + round(higher_SMB,2));
        return higher_SMB;
    }
    console.error('SMB delivery ratio set to interpolated value ' + round(new_SMB,2));
    return new_SMB;
}
//end autoISF

var determine_basal = function determine_basal(glucose_status, currenttemp, iob_data, profile, autosens_data, meal_data, tempBasalFunctions, microBolusAllowed, reservoir_data, currentTime, pumphistory, preferences, basalprofile, oref2_variables, middleWare) {


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
   // const weightedAverage = oref2_variables.weightedAverage;
   // const weightPercentage = profile.weightPercentage;
   // const average_total_data = oref2_variables.average_total_data;
   const tempHBT = oref2_variables.hbt;
   const tempHBTset = oref2_variables.isEnabled;
   const avgDelta = glucose_status.avgdelta;



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
    // If you have not set this to.0.025 (newer Medtronic pumps) in FAX settings, this will be set to 0.05 (older Medtronic pumps and Omnipods) in code.
    var minimalDose = profile.bolus_increment;
    if (minimalDose != 0.025) {
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
                       //console.log("Dynamic ratios log: scheduled insulin added: " + accountForIncrements(basalScheduledRate_ * basDuration) + " U. Bas duration: " + basDuration.toPrecision(3) + " h. Base Rate: " + basalScheduledRate_ + " U/h" + ". Time :" + baseTime_);
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
                               //console.log("Dynamic ratios log: scheduled insulin added: " + accountForIncrements(basalScheduledRate_ * basDuration) + " U. Bas duration: " + basDuration.toPrecision(3) + " h. Base Rate: " + basalScheduledRate_ + " U/h" + ". Time :" + baseTime_);
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
                           //console.log("Dynamic ratios log: scheduled insulin added: " + accountForIncrements(basalScheduledRate_ * basDuration) + " U. Bas duration: " + basDuration.toPrecision(3) + " h. Base Rate: " + basalScheduledRate_ + " U/h" + ". Time :" + baseTime_);
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
    //    } else if (pumpData < 21) {
    //        dynISFenabled = false;
    //        enableDynamicCR = false;
       } else {  dataLog = ""; }
   }

   // Calculate tdd ----------------------------------------------------------------------

   var PHlastBolus = 0;
   var PHlastBolusAge = 0;
   round(( new Date(systemTime).getTime() - meal_data.lastBolusNormalTime ) / 60000,1)
   //Bolus:
   for (let i = 0; i < pumphistory.length; i++) {
       if (pumphistory[i]._type == "Bolus") {
           bolusInsulin += pumphistory[i].amount;
           if (PHlastBolus == 0 && pumphistory[i].amount >= profile.iTime_Start_Bolus) {
            PHlastBolus = round_basal(pumphistory[i].amount,profile);
            var PHBolusTime  = new Date(pumphistory[i].timestamp);
            var currentDate =  new Date();
            PHlastBolusAge = round((currentDate - PHBolusTime) / 36e5 * 60);
           }
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
           // If temp basal hasn't yet ended, use now as end date for calculation
           do {
               j--;
               if (j == 0) {
                   morePresentTime =  new Date();
                   break;
               } else if (pumphistory[j]._type == "TempBasal" || pumphistory[j]._type == "PumpSuspend") {
                       morePresentTime = new Date(pumphistory[j].timestamp);
                       break;
                 }
           }
           while (j > 0);

           var diff = (morePresentTime - pastTime) / 36e5;
           if (diff < origDur) {
               duration = diff;
           }

           insulin = quota * duration;
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
       tddReason = ", TDD, 24h: " + round(tdd,1);
       console.error(logOutPut);
   } else { tddReason = ", TDD: Not enough pumpData (< 21h)"; }

   // -------------------- END OF TDD ----------------------------------------------------
   // ------------------------------------------------------------------------------------

// Set variables required for evaluating error conditions
    var rT = {}; //short for requestedTemp
    var insulinForManualBolus = 0;
    var manualBolusErrorString = 0;
    var deliverAt = new Date();
    if (currentTime) {
        deliverAt = new Date(currentTime);
    }


    if (typeof profile === 'undefined' || typeof profile.current_basal === 'undefined') {
        rT.error ='Error: could not get current basal rate';
        return rT;
    }
    var profile_current_basal = round_basal(profile.current_basal, profile);
    var basal = profile_current_basal;

    var systemTime = new Date();
    if (currentTime) {
        systemTime = new Date(currentTime);
    }
    var bgTime = new Date(glucose_status.date);
    var minAgo = round( (systemTime - bgTime) / 60 / 1000 ,1);

    var bg = glucose_status.glucose;
    var noise = glucose_status.noise;
    // 38 is an xDrip error state that usually indicates sensor failure
    // all other BG values between 11 and 37 mg/dL reflect non-error-code BG values, so we should zero temp for those
    if (bg <= 10 || bg === 38 || noise >= 3) {  //Dexcom is in ??? mode or calibrating, or xDrip reports high noise
        rT.reason = "CGM is calibrating, in ??? state, or noise is high";
    }

    var cgmWaitLimit = 46   // is this a useful default?
    if (minAgo > 12 || minAgo < -5) { // Dexcom data is too old, or way in the future
        rT.reason = "If current system time " + systemTime + " is correct, then BG data is too old. The last BG data was read " + minAgo + "m ago at " + bgTime;
    // if BG is too old/noisy, or is changing less than 1 mg/dL/5m for 45m, cancel any high temps and shorten any long zero temps
    //cherry pick from oref upstream dev cb8e94990301277fb1016c778b4e9efa55a6edbc
    } else if ( bg > 60 && glucose_status.cgmFlatMinutes > cgmWaitLimit) {
        if ( glucose_status.last_cal && glucose_status.last_cal < 3 ) {
            rT.reason = "CGM was just calibrated";
        } else {
            rT.reason = "Error: CGM data was suspiciously flat for the past ~" + round(glucose_status.cgmFlatMinutes,1) + "m";
        }
    }

    if (bg <= 10 || bg === 38 || noise >= 3 || minAgo > 12 || minAgo < -5 || ( bg > 60 && glucose_status.cgmFlatMinutes > cgmWaitLimit )) {
        if (currenttemp.rate > basal) { // high temp is running
            rT.reason += ". Replacing high temp basal of " + currenttemp.rate + " with neutral temp of " + basal;
            rT.deliverAt = deliverAt;
            rT.temp = 'absolute';
            rT.duration = 30;
            rT.rate = basal;
            return rT;
            //return tempBasalFunctions.setTempBasal(basal, 30, profile, rT, currenttemp);
        } else if ( currenttemp.rate === 0 && currenttemp.duration > 30 ) { //shorten long zero temps to 30m
            rT.reason += ". Shortening " + currenttemp.duration + "m long zero temp to 30m. ";
            rT.deliverAt = deliverAt;
            rT.temp = 'absolute';
            rT.duration = 30;
            rT.rate = 0;
            return rT;
            //return tempBasalFunctions.setTempBasal(0, 30, profile, rT, currenttemp);
        } else { //do nothing.
            rT.reason += ". Temp " + currenttemp.rate + " <= current basal " + round(basal, 2) + "U/hr; doing nothing. ";
            return rT;
        }
    }

    var max_iob = profile.max_iob; // maximum amount of non-bolus IOB OpenAPS will ever deliver

    // if min and max are set, then set target to their average
    var target_bg;
    var min_bg;
    var max_bg;
    var high_bg;
    if (typeof profile.min_bg !== 'undefined') {
            min_bg = profile.min_bg;
    }
    if (typeof profile.max_bg !== 'undefined') {
            max_bg = profile.max_bg;
    }
    if (typeof profile.enableSMB_high_bg_target !== 'undefined') {
        high_bg = profile.enableSMB_high_bg_target;
    }
    if (typeof profile.min_bg !== 'undefined' && typeof profile.max_bg !== 'undefined') {
        target_bg = (profile.min_bg + profile.max_bg) / 2;
    } else {
        rT.error ='Error: could not determine target_bg. ';
        return rT;
    }

// Calculate sensitivityRatio based on temp targets, if applicable, or using the value calculated by autosens
    var sensitivityRatio = 1;
    var origin_sens = "";
    var high_temptarget_raises_sensitivity = profile.exercise_mode || profile.high_temptarget_raises_sensitivity;
    var normalTarget = 100;    // evaluate high/low temptarget against this, not scheduled target (which might change)
    var halfBasalTarget = 160;  // when temptarget is 160 mg/dL, run 50% basal (120 = 75%; 140 = 60%)
                                // 80 mg/dL with low_temptarget_lowers_sensitivity would give 1.5x basal, but is limited to autosens_max (1.2x by default)
    if ( profile.half_basal_exercise_target ) {
         halfBasalTarget = profile.half_basal_exercise_target;
    }
    if (tempHBTset) {halfBasalTarget = tempHBT;}  // use iAPS calculated half basal exercise target from it's advanced TT
    var exercise_ratio = 1;
    if ( high_temptarget_raises_sensitivity && profile.temptargetSet && target_bg > normalTarget
        || profile.low_temptarget_lowers_sensitivity && profile.temptargetSet && target_bg < normalTarget ) {
        process.stderr.write("highTTraisesSens: " + high_temptarget_raises_sensitivity + ", lowTTlowersSens: " + profile.low_temptarget_lowers_sensitivity + ", TT: " + target_bg + ", HBT: " + halfBasalTarget);
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
        exercise_ratio = sensitivityRatio;
        origin_sens = " from TT modifier";
        console.log("TTcalc ratio: " + sensitivityRatio + ", Target: " + target_bg + ", HBT: " + halfBasalTarget + ", Noise: " + glucose_status.noise);
        TTreason += ", Ratio TT: " + sensitivityRatio;
        process.stderr.write("Sensitivity ratio set to "+sensitivityRatio+" based on temp target of " + target_bg + "; ");
      }
     else if (typeof autosens_data !== 'undefined' && autosens_data && profile.enable_autosens) {
        sensitivityRatio = autosens_data.ratio;
        origin_sens = " from Autosens";
        autosensReason = ", autosens:, " + round(sensitivityRatio,2);
        process.stderr.write("Autosens ratio: "+sensitivityRatio+"; ");

    }

    //var iobTH_reduction_ratio = exercise_ratio; //* profile.profile_percentage / 100 * activityRatio;
    var iobTH_reduction_ratio = 1.0;
    var use_iobTH = false;
    if (profile.iob_threshold_percent != 1) {
        iobTH_reduction_ratio = profile.profile_percentage / 100 * exercise_ratio; // * activityRatio;
        use_iobTH = true;
    }

    if (sensitivityRatio) {
        basal = profile.current_basal * sensitivityRatio;
        basal = round_basal(basal, profile);
        if (basal !== profile_current_basal) {
            process.stderr.write("Adjusting basal from "+profile_current_basal+" to "+basal+"; ");
        } else {
            process.stderr.write("Basal unchanged: "+basal+"; ");
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
                process.stderr.write("target_bg unchanged: "+new_target_bg+"; ");
            } else {
                process.stderr.write("target_bg from "+target_bg+" to "+new_target_bg+"; ");
            }
            target_bg = new_target_bg;
        }
    }

    if (typeof iob_data === 'undefined' ) {
        rT.error ='Error: iob_data undefined. ';
        return rT;
    }

    var iobArray = iob_data;
    if (typeof(iob_data.length) && iob_data.length > 1) {
        iob_data = iobArray[0];
        //console.error(JSON.stringify(iob_data[0]));
    }

    if (typeof iob_data.activity === 'undefined' || typeof iob_data.iob === 'undefined' ) {
        rT.error ='Error: iob_data missing some property. ';
        return rT;
    }

    // Prep various delta variables.
    var tick;
    tick = round(glucose_status.delta,0);

    //var minDelta = Math.min(glucose_status.delta, glucose_status.short_avgdelta, glucose_status.long_avgdelta);
    var minDelta = Math.min(glucose_status.delta, glucose_status.short_avgdelta);
    var minAvgDelta = Math.min(glucose_status.short_avgdelta, glucose_status.long_avgdelta);
    var maxDelta = Math.max(glucose_status.delta, glucose_status.short_avgdelta, glucose_status.long_avgdelta);

// Adjust ISF based on sensitivityRatio
    var profile_sens = round(profile.sens,1);
    var sens = profile.sens;
    if (typeof autosens_data !== 'undefined' && autosens_data) {
        sens = profile.sens / sensitivityRatio;
        sens = round(sens, 1);
        if (sens !== profile_sens) {
            process.stderr.write("ISF from "+ convert_bg(profile_sens,profile) +" to " + convert_bg(sens,profile));
        } else {
            process.stderr.write("ISF unchanged: "+ convert_bg(sens,profile));
        }
        //process.stderr.write(" (autosens ratio "+sensitivityRatio+")");
        //isfreason += "Autosens, Ratio: " + sensitivityRatio + ", ISF: " + convert_bg(profile_sens,profile) + "\u2192" + convert_bg(sens,profile);

    }
    console.error("CR: " + profile.carb_ratio);

    console.error("----------------------------------");
    console.error(" start AIMI B30");
    console.error("----------------------------------");

    // ****** AIMI B30 basal start ****** //
    // ***************************+ //
    var aimismb = true;
    var iTimeActivation = false;
    var AIMIrate = currenttemp.rate
    var b30duration = profile.b30_duration;
    var iTime = b30duration + 1;
    console.error("B30 enabled: " + profile.use_B30);
    if (profile.use_B30 && profile.use_autoisf) {
        var iTime_Start_Bolus = profile.iTime_Start_Bolus;
        var b30targetLevel = profile.iTime_target;
        var b30upperLimit = profile.b30_upperBG;
        var b30upperdelta = profile.b30_upperdelta;
        var b30factor = profile.b30_factor;
        var B30TTset = false;
        if (profile.temptargetSet) {B30TTset=true}
        //var B30lastbolusAge = round(( new Date(systemTime).getTime() - meal_data.lastBolusNormalTime ) / 60000,1);
        var B30lastbolusAge = PHlastBolusAge;
        if (B30lastbolusAge == 0) {B30lastbolusAge = 1};
        var LastManualBolus = PHlastBolus;
        console.error("B30 last bolus above limit of " + iTime_Start_Bolus + "U was " + LastManualBolus + "U, " + B30lastbolusAge + "m ago");
        // I would suggest to have a 3rd constraint to activate B30, which is a TempTarget of eg. 90mg/dl --not in code yet
        if (LastManualBolus >= iTime_Start_Bolus && B30lastbolusAge <= b30duration && B30TTset && target_bg == b30targetLevel) {
            iTime = B30lastbolusAge;
            iTimeActivation = true;
            console.error("B30 iTime is running : " + iTime  +"m because manual bolus ("+LastManualBolus+") >= Minimum Start Bolus size ("+iTime_Start_Bolus+") and EatingSoon TT set at " + convert_bg(b30targetLevel, profile));
        }
        console.error("B30 Activation: " + iTimeActivation);
        console.error("B30 TTset: " + B30TTset + ", at " + target_bg + ", last Bolus of " + LastManualBolus + "U, " + B30lastbolusAge + "m ago. iTime remaining: " + (b30duration-iTime) + "m.");
        if (iTimeActivation) {
            if (glucose_status.delta <= b30upperdelta && bg < b30upperLimit) {
                aimismb = false;
            }
            if (iTime <= b30duration) {
                AIMIrate = round_basal(basal * b30factor,profile);
                B30reason = "AIMI B30, Temp " + AIMIrate + "U/hr for " + (b30duration-iTime) + "m, ";
            }
        }
    }
    // ******************************** //
    // ****** AIMI B30 basal end ****** //

    console.error("----------------------------------");
    console.error("start autoISF", profile.autoISF_version);  // fit onto narrow screens
    console.error("----------------------------------");
    // mod autoISF3.0-dev: if that would put us over iobTH, then reduce accordingly; allow 30% overrun
    var iobTHtolerance = 130.0;
    var iobTHvirtual = profile.iob_threshold_percent*iobTHtolerance/100.0 * profile.max_iob * iobTH_reduction_ratio;
    var iob_ThEffective = iobTHvirtual / iobTHtolerance * 100.0
    var loop_wanted_smb = loop_smb(microBolusAllowed, profile, iob_data, aimismb, use_iobTH, iob_ThEffective, iobTH_reduction_ratio);
    var enableSMB = false;
    if (microBolusAllowed && loop_wanted_smb != "oref") {
        // if ( loop_wanted_smb == "blocked" || loop_wanted_smb == "AIMI B30") {              //  FL switched SMB off
        //     enableSMB = false;
        // }
        if ( loop_wanted_smb=="enforced" || loop_wanted_smb=="fullLoop" ) {              // otherwise FL switched SMB off
            enableSMB = true;
        }
        console.error("loop_smb function overriden with autoISF checks, enableSMB = " + enableSMB);
    } else { enableSMB = enable_smb(
        profile,
        microBolusAllowed,
        meal_data,
        bg,
        target_bg,
        high_bg
       );
       console.error("loop_smb function returns enableSMB = " + enableSMB);
    }

    sens = autoISF(sens, origin_sens, target_bg, profile, glucose_status, meal_data, currentTime, autosens_data, sensitivityRatio, loop_wanted_smb, high_temptarget_raises_sensitivity, normalTarget);
    // ******************************** //
    // ****** autoISF end ****** //

    // compare currenttemp to iob_data.lastTemp and cancel temp if they don't match
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
        rT.reason = "Warning: currenttemp rate "+currenttemp.rate+" != lastTemp rate "+iob_data.lastTemp.rate+" from pumphistory; canceling temp"; // reason.conclusion started
        return tempBasalFunctions.setTempBasal(0, 0, profile, rT, currenttemp);
    }
    if ( currenttemp && iob_data.lastTemp && currenttemp.duration > 0 ) {
        // TODO: fix this (lastTemp.duration is how long it has run; currenttemp.duration is time left
        //if ( currenttemp.duration < iob_data.lastTemp.duration - 2) {
            //rT.reason = "Warning: currenttemp duration "+currenttemp.duration+" << lastTemp duration "+round(iob_data.lastTemp.duration,1)+" from pumphistory; setting neutral temp of "+basal+".";
            //return tempBasalFunctions.setTempBasal(basal, 30, profile, rT, currenttemp);
        //}
        //console.error(lastTempAge, round(iob_data.lastTemp.duration,1), round(lastTempAge - iob_data.lastTemp.duration,1));
        var lastTempEnded = lastTempAge - iob_data.lastTemp.duration;
        if ( lastTempEnded > 5 && lastTempAge > 10 ) {
            rT.reason = "Warning: currenttemp running but lastTemp from pumphistory ended "+lastTempEnded+"m ago; canceling temp"; // reason.conclusion started
            //console.error(currenttemp, round(iob_data.lastTemp,1), round(lastTempAge,1));
            return tempBasalFunctions.setTempBasal(0, 0, profile, rT, currenttemp);
        }
        // TODO: figure out a way to do this check that doesn't fail across basal schedule boundaries
        //if ( tempModulus < 25 && tempModulus > 5 ) {
            //rT.reason = "Warning: currenttemp duration "+currenttemp.duration+" + lastTempAge "+lastTempAge+" isn't a multiple of 30m; setting neutral temp of "+basal+".";
            //console.error(rT.reason);
            //return tempBasalFunctions.setTempBasal(basal, 30, profile, rT, currenttemp);
        //}
    }

    //calculate BG impact: the amount BG "should" be rising or falling based on insulin activity alone
    var bgi = round(( -iob_data.activity * sens * 5 ), 2);
    // project deviations for 30 minutes
    var deviation = round( 30 / 5 * ( minDelta - bgi ) );
    //console.error("Debug deviation: " + deviation)
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
        naive_eventualBG = round( bg - (iob_data.iob * Math.min(sens, profile.sens) ) );
    }
    // and adjust it for the deviation above
    var eventualBG = naive_eventualBG + deviation;

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
        console.log("Raising target_bg for noisy / raw CGM data, from "+target_bg+" to "+adjustedTargetBG+"; ");
        min_bg = adjustedMinBG;
        target_bg = adjustedTargetBG;
        max_bg = adjustedMaxBG;
    } else if ( bg > max_bg && profile.adv_target_adjustments && ! profile.temptargetSet ) {
        // with target=100, as BG rises from 100 to 160, adjustedTarget drops from 100 to 80
        adjustedMinBG = round(Math.max(80, min_bg - (bg - min_bg)/3 ),0);
        adjustedTargetBG =round( Math.max(80, target_bg - (bg - target_bg)/3 ),0);
        adjustedMaxBG = round(Math.max(80, max_bg - (bg - max_bg)/3 ),0);
        // if eventualBG, naive_eventualBG, and target_bg aren't all above adjustedMinBG, don’t use it
        //console.error("naive_eventualBG:",naive_eventualBG+", eventualBG:",eventualBG);
        if (eventualBG > adjustedMinBG && naive_eventualBG > adjustedMinBG && min_bg > adjustedMinBG) {
            console.log("Adjusting targets for high BG: min_bg from "+min_bg+" to "+adjustedMinBG+"; ");
            min_bg = adjustedMinBG;
        } else {
            console.log("min_bg unchanged: "+min_bg+"; ");
        }
        // if eventualBG, naive_eventualBG, and target_bg aren't all above adjustedTargetBG, don’t use it
        if (eventualBG > adjustedTargetBG && naive_eventualBG > adjustedTargetBG && target_bg > adjustedTargetBG) {
            console.log("target_bg from "+target_bg+" to "+adjustedTargetBG+"; ");
            target_bg = adjustedTargetBG;
        } else {
            console.log("target_bg unchanged: "+target_bg+"; ");
        }
        // if eventualBG, naive_eventualBG, and max_bg aren't all above adjustedMaxBG, don’t use it
        if (eventualBG > adjustedMaxBG && naive_eventualBG > adjustedMaxBG && max_bg > adjustedMaxBG) {
            console.error("max_bg from "+max_bg+" to "+adjustedMaxBG);
            max_bg = adjustedMaxBG;
        } else {
            console.error("max_bg unchanged: "+max_bg);
        }
    }

    var expectedDelta = calculate_expected_delta(target_bg, eventualBG, bgi);
    if (typeof eventualBG === 'undefined' || isNaN(eventualBG)) {
        rT.error ='Error: could not calculate eventualBG. Sensitivity: ' + sens + ' Deviation: ' + deviation;
        return rT;
    }

    // min_bg of 90 -> threshold of 65, 100 -> 70 110 -> 75, and 130 -> 85
    //var threshold = min_bg - 0.5*(min_bg-40)
    var threshold_ratio = 0.5; //higer threshold can be set by choosing a higher smb_threshold_ratio in settings
    if (profile.smb_threshold_ratio > 0.5 && profile.smb_threshold_ratio <= 1) {
        threshold_ratio = profile.smb_threshold_ratio;
    };
    var threshold = min_bg - (1-threshold_ratio) * (min_bg - 40);
    threshold = round(threshold);
    console.log("SMB Threshold set to " + threshold_ratio + " - no SMB's applied below " + convert_bg(threshold, profile));

// Initialize rT (requestedTemp) object. Has to be done after eventualBG is calculated.
    rT = {
        'temp': 'absolute'
        , 'bg': bg
        , 'tick': tick
        , 'eventualBG': eventualBG
        , 'insulinReq': 0
        , 'current_target': target_bg // target in mg/dl
        , 'reservoir' : reservoir_data // The expected reservoir volume at which to deliver the microbolus (the reservoir volume from right before the last pumphistory run)
        , 'deliverAt' : deliverAt // The time at which the microbolus should be delivered
        , 'sensitivityRatio' : sensitivityRatio
        , 'TDD': tdd_before
        , 'insulin': insulin_
        , 'avgDelta': convert_bg(avgDelta, profile)  // convert depends on wether we want to calculate with it in OiAPS, if so we shouldn't do it and leave in mg/dL
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

    // enable UAM (if enabled in preferences)
    var enableUAM=(profile.enableUAM);


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
    csf = sens / profile.carb_ratio;
    console.error("profile.sens:" + convert_bg(profile.sens,profile) +", sens:" + convert_bg(sens,profile) + ", CSF:" + round(csf,1));

    var maxCarbAbsorptionRate = 30; // g/h; maximum rate to assume carbs will absorb if no CI observed
    // limit Carb Impact to maxCarbAbsorptionRate * csf in mg/dL per 5m
    var maxCI = round(maxCarbAbsorptionRate*csf*5/60,1);
    if (ci > maxCI) {
        console.error("Limiting carb impact from " + ci + " to " + maxCI + "mg/dL/5m (" + maxCarbAbsorptionRate + "g/h)");
        ci = maxCI;
    }
    var remainingCATimeMin = 3; // h; minimum duration of expected not-yet-observed carb absorption
    // adjust remainingCATime (instead of CR) for autosens if sensitivityRatio defined
    if (sensitivityRatio){
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
        console.error("Last carbs " + lastCarbAge + " minutes ago; remainingCATime:" + remainingCATime + "hours; " + round(fractionCOBAbsorbed*100) + "% carbs absorbed");
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
    // limit cid to remainingCATime hours: the reset goes to remainingCI
    var nfcid = 0;
    if (ci === 0) {
        // avoid divide by zero
        cid = 0;
    } else {
        if (profile.floating_carbs === true) {
            // with floating_carbs preference set, use all carbs, not just COB
            cid = Math.min(remainingCATime*60/5/2,Math.max(0, meal_data.carbs * csf / ci ));
            nfcid = Math.min(remainingCATime*60/5/2,Math.max(0, meal_data.mealCOB * csf / ci ));
            if (meal_data.carbs > 0){
                isfreason += ", Floating Carbs:, CID: " + round(cid,1) + ", MealCarbs: " + round(meal_data.carbs,1) + ", Not Floating:, CID: " + round(nfcid,1) + ", MealCOB: " + round(meal_data.mealCOB, 1);
                // isfreason += ", FloatingCarbs: " + round(meal_data.carbs,1);
                console.error("Floating Carbs CID: " + round(cid,1) + " / MealCarbs: " + round(meal_data.carbs,1) + " vs. Not Floating:" + round(nfcid,1) + " / MealCOB:" + round(meal_data.mealCOB,1));
            }
        } else {
            cid = Math.min(remainingCATime*60/5/2,Math.max(0, meal_data.mealCOB * csf / ci ));
        }
    }
    // duration (hours) = duration (5m) * 5 / 60 * 2 (to account for linear decay)
    console.error("Carb Impact:" + ci + "mg/dL per 5m; CI Duration:" + round(cid*5/60*2,1) + "hours; remaining CI (" + round(remainingCATime/2,2) + "h peak):",round(remainingCIpeak,1) + "mg/dL per 5m");

    var minIOBPredBG = 999;
    var minCOBPredBG = 999;
    var minUAMPredBG = 999;
    var minGuardBG = bg;
    var minCOBGuardBG = 999;
    var minUAMGuardBG = 999;
    var minIOBGuardBG = 999;
    var minZTGuardBG = 999;
    var minPredBG;
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
            // for IOBpredBGs, predicted deviation impact drops linearly from current deviation down to zero
            // over 60 minutes (data points every 5m)
            var predDev = ci * ( 1 - Math.min(1,IOBpredBGs.length/(60/5)) );
            IOBpredBG = IOBpredBGs[IOBpredBGs.length-1] + predBGI + predDev;
            // calculate predBGs with long zero temp without deviations
            var ZTpredBG = ZTpredBGs[ZTpredBGs.length-1] + predZTBGI;
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
            UAMpredBG = UAMpredBGs[UAMpredBGs.length-1] + predBGI + Math.min(0, predDev) + predUCI;
            //console.error(predBGI, predCI, predUCI);
            // truncate all BG predictions at 4 hours
            if ( IOBpredBGs.length < 48) { IOBpredBGs.push(IOBpredBG); }
            if ( COBpredBGs.length < 48) { COBpredBGs.push(COBpredBG); }
            if ( UAMpredBGs.length < 48) { UAMpredBGs.push(UAMpredBG); }
            if ( ZTpredBGs.length < 48) { ZTpredBGs.push(ZTpredBG); }
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
    // if (meal_data.mealCOB) {
    //     console.error("predCIs (mg/dL/5m):" + predCIs.join(" "));
    //     console.error("remainingCIs:      " + remainingCIs.join(" "));
    // }
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
            theArray[i] = round(Math.min(401,Math.max(39,p)));
        });
        for (i=COBpredBGs.length-1; i > 12; i--) {
            if (COBpredBGs[i-1] !== COBpredBGs[i]) { break; }
            else { COBpredBGs.pop(); }
        }
        rT.predBGs.COB = COBpredBGs;
        lastCOBpredBG=round(COBpredBGs[COBpredBGs.length-1]);
        eventualBG = Math.max(eventualBG, round(COBpredBGs[COBpredBGs.length-1]) );
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
        rT.eventualBG = eventualBG;  // for FAX needs to be in mg/dL
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

    process.stderr.write("minPredBG: " + convert_bg(minPredBG,profile) +" minIOBPredBG: "+convert_bg(minIOBPredBG,profile) +" minZTGuardBG: "+convert_bg(minZTGuardBG,profile));
    if (minCOBPredBG < 999) {
        process.stderr.write(" minCOBPredBG: "+convert_bg(minCOBPredBG,profile));
    }
    if (minUAMPredBG < 999) {
        process.stderr.write(" minUAMPredBG: "+convert_bg(minUAMPredBG,profile));
    }
    console.error(" avgPredBG:" + convert_bg(avgPredBG,profile) + " COB/Carbs:" + meal_data.mealCOB + "/" + meal_data.carbs);
    // But if the COB line falls off a cliff, don't trust UAM too much:
    // use maxCOBPredBG if it's been set and lower than minPredBG
    if ( maxCOBPredBG > bg ) {
        minPredBG = Math.min(minPredBG, maxCOBPredBG);
    }

    rT.COB=meal_data.mealCOB;
    rT.IOB=iob_data.iob;
    rT.bolusIOB=iob_data.bolusiob;
    rT.basalIOB=iob_data.basaliob;
    rT.iobActivity = iob_data.activity;
    rT.BGI = round(bgi, 0);
    rT.deviation = round(deviation, 0);
    rT.dura_ISFratio = round(dura_ISF,2);
    rT.bg_ISFratio = round(bg_ISF,2);
    rT.delta_ISFratio = round(delta_ISF,2);
    rT.pp_ISFratio = round(pp_ISF,2);
    rT.acce_ISFratio = round(acce_ISF,2);
    rT.auto_ISFratio = round(profile.sens / sens, 2);
    rT.ISF = round(sens, 0);
    rT.CR = round(profile.carb_ratio, 2);
    rT.TDD = round(tdd_before, 1);
    rT.current_target = round(target_bg, 0); // target in mg/dl
    rT.minDelta = minDelta; //convert_bg(minDelta, profile);
    rT.expectedDelta = expectedDelta; //convert_bg(expectedDelta, profile);
    rT.minGuardBG = minGuardBG; //convert_bg(minGuardBG, profile);
    rT.minPredBG = minPredBG; //convert_bg(minPredBG, profile);

    var smb_ratio = determine_varSMBratio(profile, bg, target_bg, loop_wanted_smb);
    rT.SMBratio = round(smb_ratio,2);
    var SMBdelreason = "SMB Del.Ratio:, " + round(smb_ratio,2);

    // Not confident but something like this in iAPS v3.0.3
    let MWreason = "";
    if (middleWare !== "" && middleWare !== "Nothing changed"){
        MWreason = "Middleware:, " + middleWare + ", ";
    }

    rT.reason =  MWreason + B30reason + SMBdelreason + autosensReason + TTreason + isfreason + ", Standard, COB: " + rT.COB + ", Dev: " + convert_bg(deviation, profile) + ", BGI: " + convert_bg(bgi, profile) + ", ISF: " + convert_bg(sens, profile) + ", CR: " + rT.CR + ", Target: " + convert_bg(target_bg, profile) + ", minPredBG " + convert_bg(minPredBG, profile) + ", minGuardBG " + convert_bg(minGuardBG, profile) + ", IOBpredBG " + convert_bg(lastIOBpredBG, profile);

    if (lastCOBpredBG > 0) {
        rT.reason += ", COBpredBG " + convert_bg(lastCOBpredBG, profile);
    }
    if (lastUAMpredBG > 0) {
        rT.reason += ", UAMpredBG " + convert_bg(lastUAMpredBG, profile);
    }
    rT.reason += tddReason;
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
            //console.error(COBpredBGs[i], min_bg);
            if ( COBpredBGs[i] < min_bg ) {
                minutesAboveMinBG = 5*i;
                break;
            }
        }
        for (i=0; i<COBpredBGs.length; i++) {
            //console.error(COBpredBGs[i], threshold);
            if ( COBpredBGs[i] < threshold ) {
                minutesAboveThreshold = 5*i;
                break;
            }
        }
    } else {
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
        rT.insulinForManualBolus = round((eventualBG - target_bg) / sens, 2);

        //rT.reason += "minGuardBG "+minGuardBG+"<"+threshold+": SMB disabled; ";
        enableSMB = false;
    }
    // Disable SMB for sudden rises (often caused by calibrations or activation/deactivation of Dexcom's noise-filtering algorithm)
    // Added maxDelta_bg_threshold as a hidden preference and included a cap at 0.4 as a safety limit
    // var maxDelta_bg_threshold = 0.2;
    // if (typeof profile.maxDelta_bg_threshold !== 'undefined') { // && loop_wanted_smb == "fullLoop") {
    //     maxDelta_bg_threshold = Math.min(profile.maxDelta_bg_threshold, 0.4); //upper ceiling for threshold hardcoded, disregarding higher profile setting
    //     console.error("maxDelta threshold for BG-Jump to allow SMB's set to: " + maxDelta_bg_threshold *100 + "%");
    // }

    // Added maxDeltaPercentage from autoISF3.0 instead of earlier maxDelta_bg_threshold
    var maxDeltaPercentage = 0.2;
    if ( loop_wanted_smb == "fullLoop" ) {              // only if SMB specifically requested, e.g. for full loop
        maxDeltaPercentage = 0.3;
    }
    if ( maxDelta > maxDeltaPercentage * bg ) {
        console.error("maxDelta "+convert_bg(maxDelta, profile)+" > "+100 * maxDeltaPercentage +"% of BG "+convert_bg(bg, profile)+" - disabling SMB");
        rT.reason += "maxDelta " + convert_bg(maxDelta, profile) + " > " + 100 * maxDeltaPercentage + "% of BG "+convert_bg(bg, profile) + " - SMB disabled!, ";
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
    var zeroTempEffect = profile.current_basal*sens*zeroTempDuration/60;
    // don't count the last 25% of COB against carbsReq
    var COBforCarbsReq = Math.max(0, meal_data.mealCOB - 0.25*meal_data.carbs);
    var carbsReq = (bgUndershoot - zeroTempEffect) / csf - COBforCarbsReq;
    zeroTempEffect = round(zeroTempEffect);
    carbsReq = round(carbsReq);
    console.error("naive_eventualBG: " + convert_bg(naive_eventualBG,profile) + ", bgUndershoot: " + convert_bg(bgUndershoot,profile) + ", zeroTempDuration: " + zeroTempDuration + ", zeroTempEffect: " + zeroTempEffect +", carbsReq: " + carbsReq);
    if ( meal_data.reason == "Could not parse clock data" ) {
        console.error("carbsReq unknown: Could not parse clock data");
    } else if ( carbsReq >= profile.carbsReqThreshold && minutesAboveThreshold <= 45 ) {
        rT.carbsReq = carbsReq;
        rT.reason += carbsReq + " add'l carbs req w/in " + minutesAboveThreshold + "m; ";
    }

// Begin core dosing logic: check for situations requiring low or high temps, and return appropriate temp after first match


    //AIMI B30 Temptarget
    if (iTimeActivation && iTime <= b30duration) {
        rT.reason += "setting AIMI B30 Temp " + round_basal(AIMIrate, profile) + "U/hr for " + (b30duration-iTime) + "m ";
        rT.temp = 'absolute';
        rT.deliverAt = deliverAt;
        rT.duration = Math.min(30,(b30duration-iTime));
        console.error("Forcing AIMI temp " + AIMIrate + "U/hr");
        return tempBasalFunctions.setTempBasal(AIMIrate, 30, profile, rT, currenttemp);
    }

    // don't low glucose suspend if IOB is already super negative and BG is rising faster than predicted
    var worstCaseInsulinReq = 0;
    var durationReq = 0;
    if (bg < threshold && iob_data.iob < -profile.current_basal*20/60 && minDelta > 0 && minDelta > expectedDelta) {
        rT.reason += "IOB "+iob_data.iob+" < " + round(-profile.current_basal*20/60,2);
        rT.reason += " and minDelta " + convert_bg(minDelta, profile) + " > " + "expectedDelta " + convert_bg(expectedDelta, profile) + "; ";
    // predictive low glucose suspend mode: BG is / is projected to be < threshold
    } else if (bg < threshold || minGuardBG < threshold) {
        rT.reason += "minGuardBG " + convert_bg(minGuardBG, profile) + "<" + convert_bg(threshold, profile);

        if (minGuardBG < threshold) {
            manualBolusErrorString = 2;
            rT.minGuardBG = minGuardBG;
        }
        insulinForManualBolus =  round((eventualBG - target_bg) / sens, 2);

        bgUndershoot = target_bg - minGuardBG;
        worstCaseInsulinReq = bgUndershoot / sens;
        durationReq = round(60*worstCaseInsulinReq / profile.current_basal);
        durationReq = round(durationReq/30)*30;
        // always set a 30-120m zero temp (oref0-pump-loop will let any longer SMB zero temp run)
        durationReq = Math.min(120,Math.max(30,durationReq));
        return tempBasalFunctions.setTempBasal(0, durationReq, profile, rT, currenttemp);
    }

    // if not in LGS mode, cancel temps before the top of the hour to reduce beeping/vibration
    // console.error(profile.skip_neutral_temps, rT.deliverAt.getMinutes());
    if ( profile.skip_neutral_temps && rT.deliverAt.getMinutes() >= 55 ) {
        if (!enableSMB) {
            rT.reason += "; Canceling temp at " + (60 - rT.deliverAt.getMinutes()) + "min before turn of the hour to avoid beeping of MDT. SMB disabled anyways.";
            return tempBasalFunctions.setTempBasal(0, 0, profile, rT, currenttemp);
        } else {
             console.error((60 - rT.deliverAt.getMinutes()) + "min before turn of the hour, but SMB's are enabled - no skipping neutral temps")
        }
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
                rT.reason += ", temp " + currenttemp.rate + " ~ req " + round(basal, 2) + "U/hr. ";
                return rT;
            } else {
                rT.reason += "; setting current basal of " + round(basal, 2) + " as temp. ";
                return tempBasalFunctions.setTempBasal(basal, 30, profile, rT, currenttemp);
            }
        }

        // calculate 30m low-temp required to get projected BG up to target
        // multiply by 2 to low-temp faster for increased hypo safety
        insulinReq = 2 * Math.min(0, (eventualBG - target_bg) / sens);
        insulinReq = round(insulinReq , 2);
        // calculate naiveInsulinReq based on naive_eventualBG
        var naiveInsulinReq = Math.min(0, (naive_eventualBG - target_bg) / sens);
        naiveInsulinReq = round( naiveInsulinReq , 2);
        if (minDelta < 0 && minDelta > expectedDelta) {
            // if we're barely falling, newinsulinReq should be barely negative
            var newinsulinReq = round((insulinReq * (minDelta / expectedDelta) ), 2);
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
        if (insulinScheduled < minInsulinReq - basal*0.3) {
            rT.reason += ", "+currenttemp.duration + "m@" + (currenttemp.rate).toFixed(2) + " is a lot less than needed. ";
            return tempBasalFunctions.setTempBasal(rate, 30, profile, rT, currenttemp);
        }
        if (typeof currenttemp.rate !== 'undefined' && (currenttemp.duration > 5 && rate >= currenttemp.rate * 0.8)) {
            rT.reason += ", temp " + currenttemp.rate + " ~< req " + round(rate,2) + "U/hr. ";
            return rT;
        } else {
            // calculate a long enough zero temp to eventually correct back up to target
            if ( rate <=0 ) {
                bgUndershoot = target_bg - naive_eventualBG;
                worstCaseInsulinReq = bgUndershoot / sens;
                durationReq = round(60*worstCaseInsulinReq / profile.current_basal);
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
            } else {
                rT.reason += ", setting " + round(rate, 2) + "U/hr. ";
            }
            return tempBasalFunctions.setTempBasal(rate, 30, profile, rT, currenttemp);
        }
    }

    // if eventual BG is above min but BG is falling faster than expected Delta
    if (minDelta < expectedDelta) {

        rT.minDelta = minDelta;
        rT.expectedDelta = expectedDelta;

        //Describe how the glucose is changing
        if (expectedDelta - minDelta >= 2 || (expectedDelta + (-1 * minDelta) >= 2)) {
            if (minDelta >= 0 && expectedDelta > 0) {
                manualBolusErrorString = 3;
            }
            else if ((minDelta < 0 && expectedDelta <= 0) ||  (minDelta < 0 && expectedDelta >= 0)) {
                manualBolusErrorString = 4;
            }
            else {
                manualBolusErrorString = 5;
            }
        }

        rT.insulinForManualBolus = round((eventualBG - target_bg) / sens, 2);

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
            rT.insulinForManualBolus = round((eventualBG - target_bg) / sens, 2);
            rT.minPredBG = minPredBG;
        }
        // if in SMB mode, don't cancel SMB zero temp
        if (! (microBolusAllowed && enableSMB )) {
            rT.reason += convert_bg(eventualBG, profile)+"-"+convert_bg(minPredBG, profile)+" in range: no temp required";
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
    }
    if (iob_data.iob > max_iob) {
        rT.reason += "IOB " + round(iob_data.iob,2) + " > maxIOB " + max_iob;
        if (currenttemp.duration > 15 && (round_basal(basal, profile) === round_basal(currenttemp.rate, profile))) {
            rT.reason += ", temp " + currenttemp.rate + " ~ req " + basal + "U/hr. ";
            return rT;
        } else {
            rT.reason += "; setting current basal of " + basal + " as temp. ";
            return tempBasalFunctions.setTempBasal(basal, 30, profile, rT, currenttemp);
        }
    } else { // otherwise, calculate 30m high-temp required to get projected BG down to target

        // insulinReq is the additional insulin required to get minPredBG down to target_bg
        //console.error(minPredBG,eventualBG);
        insulinReq = round( (Math.min(minPredBG,eventualBG) - target_bg) / sens, 2);
        insulinForManualBolus = round((eventualBG - target_bg) / sens, 2);
        // if that would put us over max_iob, then reduce accordingly
        if (insulinReq > max_iob-iob_data.iob) {
            rT.reason += "maxIOB " + max_iob + ", ";
            console.error("InsReq " + round(insulinReq,2) + " capped at " + round(max_iob-iob_data.iob,2) + " to not exceed maxIOB");
            insulinReq = max_iob-iob_data.iob;
        } else { console.error("SMB not limited by maxIOB (insulinReq: " + insulinReq + " U)");}

        if (insulinForManualBolus > max_iob-iob_data.iob) {
            console.error("Ev. Bolus limited by maxIOB to " + round(max_iob-iob_data.iob,2) + " (insulinForManualBolus: " + insulinForManualBolus + " U)");
            // rT.reason += "max_iob " + max_iob + ", ";
        } else { console.error("Ev. Bolus would not be limited by maxIOB (insulinForManualBolus: " + insulinForManualBolus + " U).");}

        // rate required to deliver insulinReq more insulin over 30m:
        rate = basal + (2 * insulinReq);
        rate = round_basal(rate, profile);
        insulinReq = round(insulinReq,3);
        rT.insulinReq = insulinReq;
        rT.insulinForManualBolus = round(insulinForManualBolus,2);
        rT.manualBolusErrorString = manualBolusErrorString;
        rT.minDelta = minDelta;
        rT.expectedDelta = expectedDelta;
        rT.minGuardBG = minGuardBG;
        rT.minPredBG = minPredBG;
        rT.threshold = convert_bg(threshold, profile);
        rT.reason = "Ins.Req:, " + round(insulinReq,2) + ", " + maxIOBreason + rT.reason;
        //console.error(iob_data.lastBolusTime);
        // minutes since last bolus
        var lastBolusAge = round(( new Date(systemTime).getTime() - iob_data.lastBolusTime ) / 60000,1);
        //console.error(lastBolusAge);
        //console.error(profile.temptargetSet, target_bg, rT.COB);
        // only allow microboluses with COB or low temp targets, or within DIA hours of a bolus
        if (microBolusAllowed && enableSMB && bg > threshold) {
            // never bolus more than maxSMBBasalMinutes worth of basal
            var mealInsulinReq = round( meal_data.mealCOB / profile.carb_ratio ,3);
            // mod 10: make the irregular mutiplier a user input but only enable with autoISF
            if ( !profile.use_autoisf ) {
              console.error("autoISF disabled, SMB range extension disabled");
              var smb_max_range = 1;
            } else {
              var smb_max_range = profile.smb_max_range_extension;
            }
            if (smb_max_range > 1) {
                console.error("SMB max range extended from default by factor "+smb_max_range)
            }
            var maxBolus = 0;
            if (typeof profile.maxSMBBasalMinutes === 'undefined' ) {
                maxBolus = round(smb_max_range * profile.current_basal * 30 / 60 ,1);
                console.error("profile.maxSMBBasalMinutes undefined: defaulting to 30m");
            //if (typeof profile.maxSMBBasalMinutes === 'undefined' ) {
            //    var maxBolus = round( profile.current_basal * 30 / 60 ,1);
            //    console.error("profile.maxSMBBasalMinutes undefined: defaulting to 30m");
            // if IOB covers more than COB, limit maxBolus to 30m of basal
            } else if ( iob_data.iob > mealInsulinReq && iob_data.iob > 0 ) {
                console.error("IOB " + iob_data.iob + " > COB " + meal_data.mealCOB + "; mealInsulinReq = " + mealInsulinReq);
                if (profile.maxUAMSMBBasalMinutes) {
                    console.error("profile.maxUAMSMBBasalMinutes:",profile.maxUAMSMBBasalMinutes,"profile.current_basal:",profile.current_basal);
                    maxBolus = round( smb_max_range * profile.current_basal * profile.maxUAMSMBBasalMinutes / 60 ,1);
                } else {
                    console.error("profile.maxUAMSMBBasalMinutes undefined: defaulting to 30m");
                    maxBolus = round( profile.current_basal * 30 / 60 ,1);
                }
            } else {
                console.error("profile.maxSMBBasalMinutes:",profile.maxSMBBasalMinutes,"profile.current_basal:",profile.current_basal);
                maxBolus = round( smb_max_range * profile.current_basal * profile.maxSMBBasalMinutes / 60 ,1);
            }
            // bolus 1/2 the insulinReq, up to maxBolus, rounding down to nearest bolus increment
            var bolusIncrement = profile.bolus_increment;
            //if (profile.bolus_increment) { bolusIncrement=profile.bolus_increment };
            var roundSMBTo = 1 / bolusIncrement;
            // mod 10: make the share of InsulinReq a user input, but only enable with autoISF
            // mod 12: make the share of InsulinReq a user configurable interpolation range
            if ( !profile.use_autoisf ) {
                console.error("autoISF disabled, don't adjust SMB Delivery Ratio");
                smb_ratio = 0.5;
            // } else {
            //     smb_ratio = determine_varSMBratio(profile, bg, target_bg, loop_wanted_smb);
            }
            if ( smb_ratio > 0.5) {
                console.error("SMB Delivery Ratio increased from default 0.5 to " + round(smb_ratio,2))
            }
            var microBolus = Math.min(insulinReq*smb_ratio, maxBolus);
            // mod autoISF3.0-dev: if that would put us over iobTH, then reduce accordingly; allow 30% overrun
            var iobTHreason = "";
            var iobTHtolerance = 130;
            var iobTHvirtual = profile.iob_threshold_percent*iobTHtolerance/100 * profile.max_iob * iobTH_reduction_ratio;
            if (microBolus > iobTHvirtual - iob_data.iob && (loop_wanted_smb=="fullLoop" || loop_wanted_smb=="enforced")) {
                microBolus = iobTHvirtual - iob_data.iob;
                //if (profile.profile_percentage!=100) {
                //    console.error("Full loop modified max_iob", profile.max_iob, "to effectively", round(profile.max_iob*profile.profile_percentage/100,1), "due to profile percentage");
                //}
                iobTHreason = ", capped by autoISF iobTH";
                console.error("autoISF capped SMB at " + round(microBolus,2) + " to not exceed " + iobTHtolerance + "% of effective iobTH " + round(iobTHvirtual/iobTHtolerance*100,2) + "U");
            }
            microBolus = Math.floor(microBolus*roundSMBTo)/roundSMBTo;
            // calculate a long enough zero temp to eventually correct back up to target
            var smbTarget = target_bg;
            worstCaseInsulinReq = (smbTarget - (naive_eventualBG + minIOBPredBG)/2 ) / sens;
            durationReq = round(60*worstCaseInsulinReq / profile.current_basal);

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
            console.error("naive_eventualBG " + convert_bg(naive_eventualBG,profile)  +", " + durationReq + "m " + smbLowTempReq + "U/h temp needed; last bolus " + lastBolusAge + "m ago; maxBolus: "+maxBolus);

            if (lastBolusAge > SMBInterval) {
                if (microBolus > 0) {
                    rT.units = microBolus;
                    rT.reason += "Microbolusing " + microBolus + "U" + iobTHreason + ". ";
                }
            } else {
                rT.reason += "Waiting " + nextBolusMins + "m " + nextBolusSeconds + "s to microbolus again. ";
            }
            //rT.reason += ". ";

            // if no zero temp is required, don't return yet; allow later code to set a high temp
            if (durationReq > 0) {
                // rT.rate = smbLowTempReq;
                // rT.duration = durationReq;
                //return rT;
                return tempBasalFunctions.setTempBasal(smbLowTempReq, durationReq, profile, rT, currenttemp);
            }

        }

        var maxSafeBasal = tempBasalFunctions.getMaxSafeBasal(profile);

        if (rate > maxSafeBasal) {
            rT.reason += "adj. req. rate: " + round(rate,2) + " to maxSafeBasal: " + round(maxSafeBasal,2) +", ";
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
module.exports = determine_basal