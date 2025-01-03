'use strict';

function reason(rT, msg) {
  rT.reason = (rT.reason ? rT.reason + '. ' : '') + msg;
  console.error(msg);
}

// Rounds value to 'digits' decimal places
function round(value, digits)
{
    if (! digits) { digits = 0; }
    var scale = Math.pow(10, digits);
    return Math.round(value * scale) / scale;
}

var tempBasalFunctions = {};

tempBasalFunctions.getMaxSafeBasal = function getMaxSafeBasal(profile) {

    var max_daily_safety_multiplier = (isNaN(profile.max_daily_safety_multiplier) || profile.max_daily_safety_multiplier === null) ? 3 : profile.max_daily_safety_multiplier;
    var current_basal_safety_multiplier = (isNaN(profile.current_basal_safety_multiplier) || profile.current_basal_safety_multiplier === null) ? 4 : profile.current_basal_safety_multiplier;

    return Math.min(profile.max_basal, max_daily_safety_multiplier * profile.max_daily_basal, current_basal_safety_multiplier * profile.current_basal);
};

tempBasalFunctions.setTempBasal = function setTempBasal(rate, duration, profile, rT, currenttemp) {
    //var maxSafeBasal = Math.min(profile.max_basal, 3 * profile.max_daily_basal, 4 * profile.current_basal);

    var maxSafeBasal = tempBasalFunctions.getMaxSafeBasal(profile);
    var round_basal = require('./round-basal');

    if (rate < 0) {
        rate = 0;
    } else if (rate > maxSafeBasal) {
      console.error("TBR " + round_basal(rate,2) + "U/hr limited by maxSafeBasal " + round_basal(maxSafeBasal,2) + "U/hr");
      reason(rT, "TBR " + round_basal(rate,2) + "U/hr limited by maxSafeBasal " + round_basal(maxSafeBasal,2) + "U/hr");
      rate = maxSafeBasal;
    }

    var suggestedRate = round_basal(rate, profile);

        // Ketocidosis Protection
    // get IOB
    var bolusIob = 0;
    if (rT.bolusIOB) {bolusIob = rT.bolusIOB};
    var basalIob = 0;
    if (rT.basalIOB) {basalIob = rT.basalIOB};
    var iobActivity = 0;
    if (rT.iobActivity) {iobActivity = rT.iobActivity};
    // Get active BaseBasalRate

    const baseBasalRate = profile.current_basal;
    var ketoReason = "";
    var ketoProtectBasalpercent = 0.2;
    var ketoProtectBasalabsolute = 0;
    var cutoff = 0;
    if (profile.keto_protect_basal_percent) {
      ketoProtectBasalpercent = Math.min(Math.max(profile.keto_protect_basal_percent * 100,5),50)  //protectBasal as percentage can be between 5 and 50%
      cutoff = baseBasalRate * ketoProtectBasalpercent / 100;
    }
    if (profile.keto_protect_absolute) {
      ketoProtectBasalabsolute = Math.min(Math.max(profile.keto_protect_basal_absolute,0),2)  //protectBasal as absolute rate can be between 0 and 2 U/hr
      cutoff = ketoProtectBasalabsolute
    }

    console.error("Keto Protect:" + profile.keto_protect + ", KetoVarProt:" + profile.variable_keto_protect_strategy + ", bolusIOB=" + round(bolusIob,3) + ", basalIOB=" + round(basalIob,3) + ", KetoProt Basal:" + profile.keto_protect_basal_percent + "%, KetoProtectAbsolut: " + profile.keto_protect_absolute + ", basalAbsolut: " + ketoProtectBasalabsolute);

    if (profile.keto_protect && profile.variable_keto_protect_strategy && bolusIob + basalIob < 0 - baseBasalRate && iobActivity < 0) {
      // Variable strategy
      if (suggestedRate < cutoff) {
        suggestedRate = cutoff;
        ketoReason = "KetoVarProt:, " + cutoff + "U/hr, ";
      }
    } else if (profile.variable_keto_protect_strategy && (bolusIob + basalIob < 0 || iobActivity < 0)) {
      ketoReason = "KetoVarProt:, not active, IOB " + round(bolusIob + basalIob,2) + " ?< " + (0-baseBasalRate) + ", iobActivity: " + round(iobActivity,3) + " ?< 0, ";
    } else if (profile.keto_protect && !profile.variable_keto_protect_strategy) {
      // Continuous strategy
      if (suggestedRate < cutoff) {
        suggestedRate = cutoff;
        ketoReason = "KetoProt:, " + cutoff + "U/hr, ";
      }
  }
  console.error(ketoReason);
  // End Ketoacidosis Protetion

  if (typeof(currenttemp) !== 'undefined' && typeof(currenttemp.duration) !== 'undefined' && typeof(currenttemp.rate) !== 'undefined' && currenttemp.duration > (duration-10) && currenttemp.duration <= 120 && suggestedRate <= currenttemp.rate * 1.2 && suggestedRate >= currenttemp.rate * 0.8 && duration > 0 ) {
    rT.reason = ketoReason + rT.reason;
    rT.reason += ", " + currenttemp.duration + "m left and " + currenttemp.rate + " ~ req " + suggestedRate + "U/hr: no change necessary";
    return rT;
  }

  if (suggestedRate === profile.current_basal) {
    if (profile.skip_neutral_temps === true) {
      if (typeof(currenttemp) !== 'undefined' && typeof(currenttemp.duration) !== 'undefined' && currenttemp.duration > 0) {
        reason(rT, 'Suggested rate is same as profile rate, a temp basal is active, canceling current temp');
        rT.duration = 0;
        rT.rate = 0;
        return rT;
      } else {
        reason(rT, 'Suggested rate is same as profile rate, no temp basal is active, doing nothing');
        return rT;
      }
    } else {
      reason(rT, 'Setting neutral temp basal of ' + profile.current_basal + 'U/hr');
      rT.duration = duration;
      rT.rate = suggestedRate;
      return rT;
    }
  } else {
    rT.reason = ketoReason + rT.reason;
    rT.duration = duration;
    rT.rate = suggestedRate;
    return rT
  }
};

module.exports = tempBasalFunctions;
