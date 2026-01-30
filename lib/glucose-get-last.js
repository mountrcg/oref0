function getDateFromEntry(entry) {
    return entry.date || Date.parse(entry.display_time) || Date.parse(entry.dateString);
}

function round(value, digits) {
    if (! digits) { digits = 0; }
    var scale = Math.pow(10, digits);
    return Math.round(value * scale) / scale;
}

var getLastGlucose = function (data) {
    //console.error("glucosegetlasttimer start")
    data = data.filter(function(obj) {
    return obj.glucose || obj.sgv;
    }).map(function prepGlucose (obj) {
        //Support the NS sgv field to avoid having to convert in a custom way
        obj.glucose = obj.glucose || obj.sgv;
        if ( obj.glucose !== null ) {
            return obj;
        }
    });
    var sizeRecords = data.length;
    const now = data[0];
    const now_date = getDateFromEntry(now); //variable change below
    const nowDate = getDateFromEntry(now);
    var change;
    var lastDeltas = [];
    var shortDeltas = [];
    var longDeltas = [];
    var avgDeltas = [];

    var bestFit = {
        duraP: 0,
        deltaPl: 0,
        deltaPn: 0,
        bgAcceleration: 0,
        a0: 0,
        a1: 0,
        a2: 0
    };

    if (sizeRecords == 1) {
        return {
            glucose: now.glucose,
            noise: 0,
            delta: 0,
            shortAvgDelta: 0,
            longAvgDelta: 0,
            date: nowDate,
            // mod 7: append 2 variables for 5% range
            dura_ISF_minutes: 0,
            dura_ISF_average: now.glucose,
            // mod 8: append 3 variables for deltas based on regression analysis
            slope05: 0, // wait for longer history
            slope15: 0, // wait for longer history
            slope40: 0, // wait for longer history
            // mod 14f: append results from best fitting parabola
            dura_p: 0,
            delta_pl: 0,
            delta_pn: 0,
            bg_acceleration: 0,
            a_0: 0,
            a_1: 0,
            a_2: 0,
            r_squ: 0
        }
    }

    var last_cal = 0;

    //console.error(now.glucose);
    for (var i=1; i < sizeRecords; i++) {
        // if we come across a cal record, don't process any older SGVs
        if (typeof data[i] !== 'undefined' && data[i].type === "cal") {
            last_cal = i;
            break;
        }
        // only use data from the same device as the most recent BG data point
        if (typeof data[i] !== 'undefined' && data[i].glucose > 39 && data[i].device === now.device) {
            const then = data[i];
            const then_date = getDateFromEntry(then);
            var avgDel = 0;
            var minutesAgo;
            if (typeof then_date !== 'undefined' && typeof now_date !== 'undefined') {
                minutesAgo = Math.round( (now_date - then_date) / (1000 * 60) );
                // multiply by 5 to get the same units as delta, i.e. mg/dL/5m
                change = now.glucose - then.glucose;
                avgDel = change/minutesAgo * 5;
                //console.error("then minutesAgo = " + minutesAgo + " avgDelta = " + round(avgDel,2));
            } else { console.error("Error: date field not found: cannot calculate avgDel"); }
            avgDeltas.push(avgDel)
            // use the average of all data points in the last 2.5m for all further "now" calculations
            //if (0 < minutesAgo && minutesAgo < 2.5) {
            //    now.glucose = ( now.glucose + then.glucose ) / 2;
            //   //console.error(then.glucose, now.glucose);
            // shortDeltas are calculated from everything ~5-15 minutes ago
            //} else
            if (2.5 < minutesAgo && minutesAgo < 17.5) {
                //console.error(minutesAgo, avgDel);
                shortDeltas.push(avgDel);
                // lastDeltas are calculated from everything ~5 minutes ago
                if (2.5 < minutesAgo && minutesAgo < 7.5) {
                    lastDeltas.push(avgDel);
                }
                //console.error(then.glucose, minutesAgo, avgDel, lastDeltas, shortDeltas);
            // longDeltas are calculated from everything ~20-40 minutes ago
            } else if (17.5 < minutesAgo && minutesAgo < 42.5) {
                longDeltas.push(avgDel);
            } else {
                break;
            }
        }
    }


    var delta = 0;
    var shortAvgDelta = 0;
    var longAvgDelta = 0;
    var avgDelta = 0;

    if (shortDeltas.length > 0) {
        shortAvgDelta = shortDeltas.reduce(function(a, b) { return a + b; }) / shortDeltas.length;
    }
    if (lastDeltas.length > 0) {
        delta = lastDeltas.reduce(function(a, b) { return a + b; }) / lastDeltas.length;
    } else {delta = shortAvgDelta}
    if (longDeltas.length > 0) {
        longAvgDelta = longDeltas.reduce(function(a, b) { return a + b; }) / longDeltas.length;
    }
    if (avgDeltas.length > 0) {
        avgDelta = avgDeltas[0]
        //console.error("most actual available avgDelta = " + round(avgDelta,2));
        }

    // calculate length of cgm values staying within a narrow band
    const bandWidth = 2;                   // max allowed width; how about mmol/L conversions?
    var minBG = now.glucose;
    var maxBG = minBG;
    var cgmFlatMinutes = 0;
    var oldDate = getDateFromEntry(now);
    for (var i = 1; i < sizeRecords; i++) {
        const then = data[i];
        const thenDate = getDateFromEntry(then);
        minBG = Math.min(minBG, then.glucose);
        maxBG = Math.max(maxBG, then.glucose);
        //          outside band            or pause > 11 minutes       or older than 1 hour
        if (maxBG-minBG > bandWidth || oldDate - thenDate > 1000 * 60 * 11 || nowDate - thenDate > 1000 * 60 * 60) {
            break
        } else {
            oldDate = thenDate
        }
    cgmFlatMinutes = ( nowDate-oldDate ) / 60000.0
    }

    // calculate 2 variables for 5% range; still using 5 minute data
    const bw = 0.05;
    var sumBG = now.glucose;
    var oldavg = now.glucose;
    var minutesdur = 0;
    var n = 1;
    for (var i = 1; i < sizeRecords; i++) {
        n += 1
        const then = data[i];
        const then_date = getDateFromEntry(then);
        // stop the series if there was a CGM gap greater than 13 minutes, i.e. 2 regular readings
        //  needs shorter gap for Libre?
        if (Math.round((now_date - then_date) / (1000 * 60)) - minutesdur > 13) {
            break;
        }
        if (then.glucose > oldavg*(1-bw) && then.glucose < oldavg*(1+bw)) {
        sumBG += then.glucose;
        oldavg = sumBG / n  // was: (i + 1)
        minutesdur = Math.round((now_date - then_date) / (1000 * 60));
        } else {
            break;
        }
    }

    // calculate best parabola and determine delta by extending it 5 minutes into the future
    // acc. https://www.codeproject.com/Articles/63170/Least-Squares-Regression-for-Quadratic-Curve-Fitti
    //
    //  y = a2*x^2 + a1*x + a0      or
    //  y = a*x^2  + b*x  + c       respectively

    // initially just test the handling of arguments

    var ppDebug = "";
    var duraP = 0;
    var deltaPl = 0;
    var deltaPn = 0;
    var bgAcceleration = 0;
    var corrMax = 0;
    var a0 = 0;
    var a1 = 0;
    var a2 = 0;
    var use1MinuteRaw = false
    var minFitDur = 15                        // minimum minutes of BG history required before fitting parabola; was 20; renamed from fslMinDur as it applies to all CGMs

    //  FSL 1-minute cgm data
    if ( sizeRecords > 2 ) {
        var current = data[0];
        var current_date = getDateFromEntry(current);
        var afterNext = data[2];
        var afterNext_date = getDateFromEntry(afterNext);
        if ( current_date - afterNext_date < 3 * 60000 ) {
            use1MinuteRaw = true
            minFitDur = 20
        }
    }

    if (sizeRecords > 3) {
        //double corrMin = 0.90;                  // go backwards until the correlation coefficient goes below
        var sy    = 0;                        // y
        var sx    = 0;                        // x
        var sx2   = 0;                        // x^2
        var sx3   = 0;                        // x^3
        var sx4   = 0;                        // x^4
        var sxy   = 0;                        // x*y
        var sx2y  = 0;                        // x^2*y
        //var corrMax = 0;
        var iframe = data[0];
        var time_0 = getDateFromEntry(iframe);
        var tiLast = 0;
        var scaleTime = 1;                    // was 300
        var scaleBg   = 1;                    // was 50
        n = 0;
        for (var i = 0; i < sizeRecords; i++) {
            if (data[i].glucose > 39) {
                n += 1
                var then = data[i];
                var then_date = getDateFromEntry(then);
                var ti = (then_date - time_0) / 1000 / scaleTime;
                if (-ti * scaleTime > 47 * 60) {                        // skip records older than 47.5 minutes
                    break;
                } else if (ti < tiLast - 11 * 60 / scaleTime) {         // stop scan if a CGM gap > 11 minutes is detected
                    if (i < 3 || -ti * scaleTime < minFitDur * 60) {     // history too short for fit & FSL safety
                        duraP = -tiLast * scaleTime / 60.0
                        deltaPl = 0;
                        deltaPn = 0;
                        bgAcceleration = 0;
                        corrMax = 0;
                        a0 = 0;
                        a1 = 0;
                        a2 = 0;
                    }
                    break;
                }
                tiLast = ti;
                var bg = then.glucose / scaleBg;
                sx += ti;
                sx2 += Math.pow(ti, 2);
                sx3 += Math.pow(ti, 3);
                sx4 += Math.pow(ti, 4);
                sy  += bg;
                sxy += ti * bg;
                sx2y += Math.pow(ti, 2) * bg;
                //var n = i + 1;
                var detH = 0;
                var detA = 0;
                var detB = 0;
                var detC = 0;
                if (n > 3 && -ti * scaleTime > minFitDur * 60) {   //FSL safety
                    detH  = sx4 * (sx2 * n - sx * sx) - sx3 * (sx3 * n - sx * sx2) + sx2 * (sx3 * sx - sx2 * sx2);
                    detA = sx2y* (sx2 * n - sx * sx) - sxy * (sx3 * n - sx * sx2) + sy  * (sx3 * sx - sx2 * sx2);
                    detB = sx4 * (sxy * n - sy * sx) - sx3 * (sx2y* n - sy * sx2) + sx2 * (sx2y* sx - sxy * sx2);
                    detC = sx4 * (sx2 *sy - sx *sxy) - sx3 * (sx3 *sy - sx *sx2y) + sx2 * (sx3 *sxy - sx2 * sx2y);
                }
                if (detH != 0) {
                    var a = detA / detH * scaleBg * Math.pow(300 / scaleTime, 2);
                    var b = detB / detH * scaleBg * (300 / scaleTime);
                    var c = detC / detH * scaleBg;
                    var yMean = sy / n;
                    var sSquares = 0;
                    var sResidualSquares = 0;
                    for (var j = 0; j <= i; j++) {
                        var before = data[j];
                        var before_date = getDateFromEntry(before);
                        sSquares += Math.pow(before.glucose / scaleBg - yMean, 2);
                        var deltaT = (before_date - time_0) / 1000 / 300;
                        var bgj = a * Math.pow(deltaT, 2) + b * deltaT + c;
                        sResidualSquares += Math.pow(before.glucose / scaleBg - bgj / scaleBg, 2);
                    }
                    var rSqu = 0;
                    if (sSquares != 0) {
                        rSqu = Number(((1 - sResidualSquares / sSquares).toFixed(4)));
                    }
                    if (rSqu >= corrMax) {
                        corrMax = rSqu;
                        duraP = Math.round((-ti * scaleTime / 60) * 10000) / 10000;    // remember we are going backwards in time
                        var delta5Min = 1;                                               //5 * 60 / scaleTime
                        deltaPl =-(a * Math.pow(- delta5Min, 2) - b * delta5Min);     // 5 minute slope from last fitted bg ending at this bg, i.e. t=0
                        deltaPn =  (a * Math.pow( delta5Min, 2) + b * delta5Min);     // 5 minute slope to next fitted bg starting from this bg, i.e. t=0
                        bgAcceleration = Math.round((2 * a) * 10000) / 10000;
                        a0 = Math.round(c * 10000) / 10000;
                        a1 = Math.round(b * 10000) / 10000;
                        a2 = Math.round(a * 10000) / 10000;
                        bestFit = { duraP, deltaPl, deltaPn, bgAcceleration, a0, a1, a2 };  // Store best fit
                    }
                }
            }
        }
        ({ duraP, deltaPl, deltaPn, bgAcceleration, a0, a1, a2 } = bestFit);

    }

    ppDebug = "glucose: " + round(now.glucose,0) +
        ", noise: " + 0 + " " +
        ", delta: " + round(delta,0) +
        ", short_avgdelta: " + " " + round(shortAvgDelta,2) +
        ", long_avgdelta: " + round(longAvgDelta,2) +
        ", cgmFlatMinutes: " + round(cgmFlatMinutes,0) +
        ", date: " + now.date +
        ", dura_ISF_minutes: " + round(minutesdur,0) +
        ", dura_ISF_average: " + round(oldavg,2) +
        ", parabola_fit_correlation: " + round(corrMax,4) +
        ", parabola_fit_minutes: " + round(duraP,2) +
        ", parabola_fit_last_delta: " + round(deltaPl,2) +
        ", parabola_fit_next_delta: " + round(deltaPn,2) +
        ", parabola_fit_a0: " + round(a0,2) +
        ", parabola_fit_a1: " + round(a1,2) +
        ", parabola_fit_a2: " + round(a2,2) +
        ", bg_acceleration: " + round(bgAcceleration,2)



    //console.error("glucosegetlasttimer end");
    return {
        glucose: Math.round( now.glucose * 10000 ) / 10000
        , noise: 0  // , noise: Math.round(now.noise) //for now set to nothing as not all CGMs report noise
        , delta: Math.round( delta * 10000 ) / 10000
        , short_avgdelta: Math.round( shortAvgDelta * 10000 ) / 10000
        , long_avgdelta: Math.round( longAvgDelta * 10000 ) / 10000
        , avgdelta: Math.round( avgDelta * 10000 ) / 10000
        // autoISF values to return to determineBasal.js
        , cgmFlatMinutes: Math.round(cgmFlatMinutes * 10000 ) / 10000
        , dura_ISF_minutes: Math.round( minutesdur* 10000 ) / 10000
        , dura_ISF_average: Math.round( oldavg * 10000 ) / 10000
        , dura_p: Math.round( duraP * 10000) / 10000
        , delta_pl: Math.round( deltaPl * 10000) / 10000
        , delta_pn: Math.round( deltaPn * 10000) / 10000
        , bg_acceleration: bgAcceleration
        , r_squ: Math.round( corrMax * 10000) / 10000
        , a_0: Math.round( a0 * 10000) / 10000
        , a_1: Math.round( a1 * 10000) / 10000
        , a_2: Math.round( a2 * 10000) / 10000
        , pp_debug: ppDebug
        // end autoISF values
        , date: now_date
        , last_cal: last_cal
        , device: now.device
    };
;}
module.exports = getLastGlucose;