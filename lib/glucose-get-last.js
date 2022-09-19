function getDateFromEntry(entry) {
    return entry.date || Date.parse(entry.display_time) || Date.parse(entry.dateString);
}

function round(value, digits) {
    if (! digits) { digits = 0; }
    var scale = Math.pow(10, digits);
    return Math.round(value * scale) / scale;
}

var getLastGlucose = function (data) {
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

    if (sizeRecords == 1) {
        return {
            glucose: now.value,
            noise: 0,
            delta: 0,
            shortAvgDelta: 0,
            longAvgDelta: 0,
            date: nowDate,
            // mod 7: append 2 variables for 5% range
            dura_ISF_minutes: 0,
            dura_ISF_average: now.value,
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
        if (typeof data[i] !== 'undefined' && data[i].glucose > 38 && data[i].device === now.device) {
            const then = data[i];
            const then_date = getDateFromEntry(then);
            var avgDel = 0;
            var minutesAgo;
            if (typeof then_date !== 'undefined' && typeof now_date !== 'undefined') {
                minutesAgo = Math.round( (now_date - then_date) / (1000 * 60) );
                // multiply by 5 to get the same units as delta, i.e. mg/dL/5m
                change = now.glucose - then.glucose;
                avgDel = change/minutesAgo * 5;
                console.error("then minutesAgo = " + minutesAgo + " avgDelta = " + round(avgDel,2));
            } else { console.error("Error: date field not found: cannot calculate avgDel"); }

            // use the average of all data points in the last 2.5m for all further "now" calculations
            if (0 < minutesAgo && minutesAgo < 2.5) {
                now.glucose = ( now.glucose + then.glucose ) / 2;
                now_date = ( now_date + then_date ) / 2;
                //console.error(then.glucose, now.glucose);
            // shortDeltas are calculated from everything ~5-15 minutes ago
            } else if (2.5 < minutesAgo && minutesAgo < 17.5) {
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

    if (shortDeltas.length > 0) {
        shortAvgDelta = shortDeltas.reduce(function(a, b) { return a + b; }) / shortDeltas.length;
    }
    if (lastDeltas.length > 0) {
        delta = lastDeltas.reduce(function(a, b) { return a + b; }) / lastDeltas.length;
    } else {delta = shortAvgDelta}
    if (longDeltas.length > 0) {
        longAvgDelta = longDeltas.reduce(function(a, b) { return a + b; }) / longDeltas.length;
    }

    // start autoISF by https://github.com/ga-zelle/autoISF , relevant variables and functions
    // mod 7: append 2 variables for 5% range
    var dura_ISF_minutes = 0;
    var dura_ISF_average = now.glucose;
    // mod 8: append 3 variables for deltas based on regression analysis
    var slope05 = 0;
    var slope15 = 0;
    var slope40 = 0;
    // mod 14f: append results from best fitting parabola
    var duraP = 0;
    var deltaPl = 0;
    var deltaPn = 0;
    var r_squ = 0;
    var bg_acceleration = 0;
    var a_0 = 0;
    var a_1 = 0;
    var a_2 = 0;
    var ppDebug = "autoISF Mod14-Debug: ";
    const bw = 0.05;
    var sumBG = now.glucose;
    var oldavg = now.glucose;
    var minutesdur = 0;
    for (var i = 1; i < sizeRecords; i++) {
        const then = data[i];
        const then_date = getDateFromEntry(then);
    //  mod 7c: stop the series if there was a CGM gap greater than 13 minutes, i.e. 2 regular readings
        if (Math.round((now_date - then_date) / (1000 * 60)) - minutesdur > 13) {
            break;
        }
        if (then.glucose > oldavg*(1-bw) && then.glucose < oldavg*(1+bw)) {
        sumBG += then.glucose;
        oldavg = sumBG / (i+1);
        minutesdur = Math.round((now_date - then_date) / (1000 * 60));
        } else {
            break;
        }
    }

    // var autoISFAverage = oldavg                      no longer used
    // var autoISFDuration = minutesdur.toDouble()      no longer used

    // mod 8: calculate 3 variables for deltas based on linear regression
    // initially just test the handling of arguments
    var slope05 = 1.05;
    var slope15 = 1.15;
    var slope40 = 1.40;

    // mod 8a: now do the real maths based on
    // http://www.carl-engler-schule.de/culm/culm/culm2/th_messdaten/mdv2/auszug_ausgleichsgerade.pdf
    var sumBG  = 0;         // y
    var sumt   = 0;         // x
    var sumBG2 = 0;         // y^2
    var sumt2  = 0;         // x^2
    var sumxy  = 0;         // x*y
    //double a;
    var b;                   // y = a + b * x
    var level = 7.5;
    var minutesL;
    // here, longer deltas include all values from 0 up the related limit
    for (var i = 0; i < sizeRecords; i++) {
        var then = data[i];
        var then_date = getDateFromEntry(then);
        minutesL = (now_date - then_date) / (1000 * 60);
        // watch out: the scan goes backwards in time, so delta has wrong sign
        if(i * sumt2 == sumt * sumt) {
            b = 0.0;
        }
        else {
            b = (i * sumxy - sumt * sumBG) / (i * sumt2 - sumt * sumt);
        }
        if (minutesL > level && level == 7.5) {
            slope05 = -b * 5;
            level = 17.5;
        }
        if (minutesL > level && level == 17.5) {
            slope15 = -b * 5;
            level = 42.5;
        }
        if (minutesL > level && level == 42.5) {
            slope40 = -b * 5;
            break;
        }

        sumt   += minutesL;
        sumt2  += minutesL * minutesL;
        sumBG  += then.glucose;
        sumBG2 += then.glucose * then.glucose;
        sumxy  += then.glucose * minutesL;
    }

    // mod 14f: calculate best parabola and determine delta by extending it 5 minutes into the future
    // nach https://www.codeproject.com/Articles/63170/Least-Squares-Regression-for-Quadratic-Curve-Fitti
    //
    //  y = a2*x^2 + a1*x + a0      or
    //  y = a*x^2  + b*x  + c       respectively

    // initially just test the handling of arguments

    var ppDebug = "";
    var bestA = 0;
    var bestB = 0;
    var bestC = 0;
    var duraP = 0;
    var deltaPl = 0;
    var deltaPn = 0;
    var bgAcceleration = 0;
    var corrMax = 0;
    var a0 = 0;
    var a1 = 0;
    var a2 = 0;

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
        //# for best numerical accurarcy time and bg must be of same order of magnitude
        var scaleTime = 300;                  //# in 5m; values are  0, 1, 2, 3, 4, ...
        var scaleBg   =  50;                  //# TIR range is now 1.4 - 3.6

        for (var i = 0; i < sizeRecords; i++) {
            var then = data[i];
            var then_date = getDateFromEntry(then);
            // skip records older than 47.5 minutes
            var ti = (then_date - time_0) / 1000 / scaleTime;
            if (-ti *scaleTime > 47 * 60) {                        // skip records older than 47.5 minutes
                break;
            } else if (ti < tiLast - 7.5 * 60 / scaleTime) {       // stop scan if a CGM gap > 7.5 minutes is detected
                if ( i<3) {                             // history too short for fit
                    duraP =  -tiLast / 60;
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
            var bg = then.glucose/scaleBg;
            sx += ti;
            sx2 += Math.pow(ti, 2);
            sx3 += Math.pow(ti, 3);
            sx4 += Math.pow(ti, 4);
            sy  += bg;
            sxy += ti * bg;
            sx2y += Math.pow(ti, 2) * bg;
            var n = i + 1;
            var D  = 0;
            var Da = 0;
            var Db = 0;
            var Dc = 0;
            if (n > 3) {
                D  = sx4 * (sx2 * n - sx * sx) - sx3 * (sx3 * n - sx * sx2) + sx2 * (sx3 * sx - sx2 * sx2);
                Da = sx2y* (sx2 * n - sx * sx) - sxy * (sx3 * n - sx * sx2) + sy  * (sx3 * sx - sx2 * sx2);
                Db = sx4 * (sxy * n - sy * sx) - sx3 * (sx2y* n - sy * sx2) + sx2 * (sx2y* sx - sxy * sx2);
                Dc = sx4 * (sx2 *sy - sx *sxy) - sx3 * (sx3 *sy - sx *sx2y) + sx2 * (sx3 *sxy - sx2 * sx2y);
            }
            if (D != 0) {
                var a = Da / D;
                b = Db / D;              // b initialised in linear fit !
                var c = Dc / D;
                var yMean = sy / n;
                var sSquares = 0;
                var sResidualSquares = 0;
                for (var j = 0; j <= i; j++) {
                    var before = data[j];
                    var before_date = getDateFromEntry(before);
                    sSquares += Math.pow(before.glucose / scaleBg - yMean, 2);
                    var deltaT = (before_date - time_0) / 1000 / scaleTime;
                    var bgj = a * Math.pow(deltaT, 2) + b * deltaT + c;
                    sResidualSquares += Math.pow(before.glucose / scaleBg - bgj, 2);
                }
                var rSqu = 0.64;
                if (sSquares != 0) {
                    rSqu = 1 - sResidualSquares / sSquares;
                }
                if (n > 3) {
                    if (rSqu >= corrMax) {
                        corrMax = rSqu;
                        // double delta_t = (then_date - time_0) / 1000;
                        duraP = -ti * scaleTime / 60;            // remember we are going backwards in time
                        var delta5Min = 5 * 60 / scaleTime;
                        deltaPl =-scaleBg * (a * Math.pow(- delta5Min, 2) - b * delta5Min);     // 5 minute slope from last fitted bg starting from last bg, i.e. t=0
                        deltaPn = scaleBg * (a * Math.pow( delta5Min, 2) + b * delta5Min);     // 5 minute slope to next fitted bg starting from last bg, i.e. t=0
                        bgAcceleration = 2 * a * scaleBg;
                        a0 = c * scaleBg;
                        a1 = b * scaleBg;
                        a2 = a * scaleBg;
                        bestA = a * scaleBg;
                        bestB = b * scaleBg;
                        bestC = c * scaleBg;
                    }
                }
            }
        }
        ppDebug += "coeffs a/b/c=(" + round(bestA,2) + " / " + round(bestB,2) + " / " + round(bestC,2) + "); bg date=" + time_0 + "; ";
        ppDebug += "Parabola Fits a0/a1/a2=(" + round(a0,2) + " / " + round(a1,2) + " / " + round(a2,2) + "); BGaccel=" + bgAcceleration;
    }
    ppDebug += "Slopes 05/15/40=(" + round(slope05,2) + " / " + round(slope15,2) + " / " + round(slope40,2) + "); "
    return {
        glucose: Math.round( now.glucose * 10000 ) / 10000
        , noise: 0  // , noise: Math.round(now.noise) //for now set to nothing as not all CGMs report noise
        , delta: Math.round( delta * 10000 ) / 10000
        , short_avgdelta: Math.round( shortAvgDelta * 10000 ) / 10000
        , long_avgdelta: Math.round( longAvgDelta * 10000 ) / 10000
        // autoISF values to return to determineBasal.js
        , dura_ISF_minutes: Math.round( minutesdur* 10000 ) / 10000
        , dura_ISF_average: Math.round( oldavg * 10000 ) / 10000
        , slope05: Math.round( slope05 * 10000 ) / 10000
        , slope15: Math.round( slope15 * 10000 ) / 10000
        , slope40: Math.round( slope40 * 10000 ) / 10000
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
}
module.exports = getLastGlucose;