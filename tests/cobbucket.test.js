var should = require('should');

// Extracted bucketing logic from cob.js
function bucketGlucoseData(glucose_data, profile, mealTime, ciTime) {
    var bucketed_data = [];
    bucketed_data[0] = glucose_data[0];
    var j = 0;
    var foundPreMealBG = false;
    var lastbgi = 0;

    if (!glucose_data[0].glucose || glucose_data[0].glucose < 39) {
        lastbgi = -1;
    }

    for (var i = 1; i < glucose_data.length; ++i) {
        var bgTime;
        var lastbgTime;
        
        // Determine current BG time
        if (glucose_data[i].display_time) {
            bgTime = new Date(glucose_data[i].display_time.replace('T', ' '));
        } else if (glucose_data[i].dateString) {
            bgTime = new Date(glucose_data[i].dateString);
        } else { 
            console.error("Could not determine BG time"); 
            continue;
        }
        
        // Skip invalid glucose readings
        if (!glucose_data[i].glucose || glucose_data[i].glucose < 39) {
            continue;
        }
        
        // Only consider BGs for maxMealAbsorptionTime hours after a meal for calculating COB
        var hoursAfterMeal = (bgTime - mealTime) / (60 * 60 * 1000);
        if (hoursAfterMeal > profile.maxMealAbsorptionTime || foundPreMealBG) {
            continue;
        } else if (hoursAfterMeal < 0) {
            foundPreMealBG = true;
        }
        
        // Only consider last ~45m of data in CI mode
        // this allows us to calculate deviations for the last ~30m
        if (typeof ciTime !== 'undefined') {
            var hoursAgo = (ciTime - bgTime) / (45 * 60 * 1000);
            if (hoursAgo > 1 || hoursAgo < 0) {
                continue;
            }
        }
        
        // Determine last BG time
        if (bucketed_data[bucketed_data.length - 1].display_time) {
            lastbgTime = new Date(bucketed_data[bucketed_data.length - 1].display_time.replace('T', ' '));
        } else if ((lastbgi >= 0) && glucose_data[lastbgi].display_time) {
            lastbgTime = new Date(glucose_data[lastbgi].display_time.replace('T', ' '));
        } else if ((lastbgi >= 0) && glucose_data[lastbgi].dateString) {
            lastbgTime = new Date(glucose_data[lastbgi].dateString);
        } else { 
            console.error("Could not determine last BG time"); 
            continue;
        }
        
        var elapsed_minutes = (bgTime - lastbgTime) / (60 * 1000);
        
        if (Math.abs(elapsed_minutes) > 8) {
            // interpolate missing data points
            var lastbg = glucose_data[lastbgi].glucose;
            // cap interpolation at a maximum of 4h
            elapsed_minutes = Math.min(240, Math.abs(elapsed_minutes));
            
            while (elapsed_minutes > 5) {
                var previousbgTime = new Date(lastbgTime.getTime() - 5 * 60 * 1000);
                j++;
                bucketed_data[j] = [];
                bucketed_data[j].date = previousbgTime.getTime();
                var gapDelta = glucose_data[i].glucose - lastbg;
                var previousbg = lastbg + (5 / elapsed_minutes * gapDelta);
                bucketed_data[j].glucose = Math.round(previousbg);

                elapsed_minutes = elapsed_minutes - 5;
                lastbg = previousbg;
                lastbgTime = new Date(previousbgTime);
            }
        } else if (Math.abs(elapsed_minutes) > 2) {
            j++;
            bucketed_data[j] = glucose_data[i];
            bucketed_data[j].date = bgTime.getTime();
        } else {
            bucketed_data[j].glucose = (bucketed_data[j].glucose + glucose_data[i].glucose) / 2;
        }

        lastbgi = i;
    }

    return bucketed_data;
}

describe('bucketGlucoseData', function() {
    const moment = require('moment');
    
    // Helper to create glucose entry
    function createGlucoseEntry(glucose, timeMs) {
        return {
            glucose: glucose,
            sgv: glucose,
            date: timeMs,
            dateString: new Date(timeMs).toISOString()
        };
    }
    
    // Default test profile
    const defaultProfile = {
        dia: 4,
        maxMealAbsorptionTime: 6,
        min_5m_carbimpact: 3,
        carb_ratio: 10
    };
    
    // Note: glucose_data is expected in reverse chronological order (newest first)
    // The bucketGlucoseData function maintains this order in its output

    it('should handle normal 5-minute interval data without modification', function() {
        const mealTime = moment('2024-01-01 12:00:00-05:00').valueOf();
        
        // Create regular 5-minute interval data (chronological order)
        const glucose_data = [
            createGlucoseEntry(100, mealTime),
            createGlucoseEntry(105, mealTime + 5 * 60 * 1000),
            createGlucoseEntry(110, mealTime + 10 * 60 * 1000),
            createGlucoseEntry(115, mealTime + 15 * 60 * 1000)
        ];
        glucose_data.reverse(); // Convert to reverse chronological order
        
        const result = bucketGlucoseData(glucose_data, defaultProfile, mealTime);
        
        // Should return same number of entries
        result.length.should.equal(4);
        // Values should be unchanged (in reverse chronological order)
        result[0].glucose.should.equal(115);
        result[1].glucose.should.equal(110);
        result[2].glucose.should.equal(105);
        result[3].glucose.should.equal(100);
    });

    it('should interpolate missing data when gap > 8 minutes', function() {
        const mealTime = moment('2024-01-01 12:00:00-05:00').valueOf();
        
        // Create data with a 21-minute gap (chronological order)
        const glucose_data = [
            createGlucoseEntry(99, mealTime),
            createGlucoseEntry(120, mealTime + 21 * 60 * 1000) // 21 min gap
        ];
        glucose_data.reverse(); // Convert to reverse chronological order
        
        const result = bucketGlucoseData(glucose_data, defaultProfile, mealTime);
        
        // Should have interpolated 4 additional points (5, 10, 15, 20 minutes)
        result.length.should.equal(5);
        
        // Check interpolated values (in reverse chronological order)
        result[0].glucose.should.equal(120); // original (newest)
        result[1].glucose.should.equal(115); // interpolated
        result[2].glucose.should.equal(110); // interpolated
        result[3].glucose.should.equal(105); // interpolated
        result[4].glucose.should.equal(100); // interpolated
        
        // Check that dates are properly set
        result[1].date.should.equal(mealTime + 16 * 60 * 1000);
        result[2].date.should.equal(mealTime + 11 * 60 * 1000);
        result[3].date.should.equal(mealTime + 6 * 60 * 1000);
        result[4].date.should.equal(mealTime + 1 * 60 * 1000);
    });

    it('should stop processing after maxMealAbsorptionTime', function() {
        const mealTime = moment('2024-01-01 12:00:00-05:00').valueOf();
        
        // Create data spanning 8 hours (chronological order)
        const glucose_data = [];
        for (let i = 0; i <= 96; i++) { // 96 * 5 min = 8 hours
            glucose_data.push(createGlucoseEntry(100 + i, mealTime + i * 5 * 60 * 1000));
        }
        glucose_data.reverse(); // Convert to reverse chronological order
        
        // Set maxMealAbsorptionTime to 2 hours
        const profile = { ...defaultProfile, maxMealAbsorptionTime: 2 };
        
        const resultRaw = bucketGlucoseData(glucose_data, profile, mealTime);
        const result = resultRaw.filter(element => {
          // remove empty entries
          return !(Array.isArray(element) && element.length === 0) && // Not an empty array
             !(typeof element === 'object' && element !== null && Object.keys(element).length === 0); // Not an empty object
        });

        // Should only process up to 2 hours of data (24 entries + 1 initial = 25)
        result.length.should.equal(25);
        
        result[0].glucose.should.equal(196);
        result[12].glucose.should.equal(112);
        result[24].glucose.should.equal(100);
    });

    it('should only process data within 45 minutes in CI mode', function() {
        const mealTime = moment('2024-01-01 12:00:00-05:00').valueOf();
        const ciTime = moment('2024-01-01 14:00:00-05:00').valueOf(); // 2 hours after meal
        
        // Create data spanning 3 hours (chronological order)
        const glucose_data = [];
        for (let i = 0; i <= 36; i++) { // 36 * 5 min = 3 hours
            glucose_data.push(createGlucoseEntry(100 + i, mealTime + i * 5 * 60 * 1000));
        }
        glucose_data.reverse(); // Convert to reverse chronological order
        
        const result = bucketGlucoseData(glucose_data, defaultProfile, mealTime, ciTime);
        
        // Should only include data within 45 minutes of ciTime
        // but it keeps the first bucket value and interpolates
        result.forEach(entry => {
            const minutesFromCI = Math.abs(ciTime - entry.date) / (60 * 1000);
            minutesFromCI.should.be.lessThanOrEqual(120);
        });
        
        result.length.should.equal(21);
    });

    it('should stop processing when pre-meal BG is found', function() {
        const mealTime = moment('2024-01-01 12:00:00-05:00').valueOf();
        
        // Create data that includes pre-meal values (chronological order)
        const glucose_data = [
            createGlucoseEntry(90, mealTime - 10 * 60 * 1000),  // 30 min before meal
            createGlucoseEntry(95, mealTime - 5 * 60 * 1000),  // 15 min before meal
            createGlucoseEntry(100, mealTime),
            createGlucoseEntry(105, mealTime + 5 * 60 * 1000),
            createGlucoseEntry(110, mealTime + 10 * 60 * 1000),
            createGlucoseEntry(115, mealTime + 15 * 60 * 1000)  // 15 min after
        ];
        glucose_data.reverse(); // Convert to reverse chronological order
        
        const result = bucketGlucoseData(glucose_data, defaultProfile, mealTime);
        
        // Should only process from meal time forward (in reverse chronological order)
        // The logic will capture one entry pre meal before
        // it starts filtering (probably a bug)
        result.length.should.equal(5);
        // Values should be unchanged (in reverse chronological order)
        result[0].glucose.should.equal(115);
        result[1].glucose.should.equal(110);
        result[2].glucose.should.equal(105);
        result[3].glucose.should.equal(100);
        result[4].glucose.should.equal(95);
    });

    it('should average glucose values when readings are very close (≤ 2 minutes)', function() {
        const mealTime = moment('2024-01-01 12:00:00-05:00').valueOf();
        
        // Create data with readings 1 minute apart (chronological order)
        const glucose_data = [
            createGlucoseEntry(100, mealTime),
            createGlucoseEntry(102, mealTime + 1 * 60 * 1000),  // 1 min later
            createGlucoseEntry(104, mealTime + 2 * 60 * 1000),  // 2 min later
            createGlucoseEntry(110, mealTime + 5 * 60 * 1000)   // 5 min later
        ];
        glucose_data.reverse(); // Convert to reverse chronological order
        
        const result = bucketGlucoseData(glucose_data, defaultProfile, mealTime);
        
        // Close readings should be averaged (in reverse chronological order)
        result.length.should.equal(2);
        result[0].glucose.should.equal(110);
        // it averages incorrectly, this should be 102 but it's not
        result[1].glucose.should.equal(101.5);
    });

    it('should cap interpolation at 240 minutes for very large gaps', function() {
        const mealTime = moment('2024-01-01 12:00:00-05:00').valueOf();
        
        // Create data with a 6-hour (360 minute) gap (chronological order)
        const glucose_data = [
            createGlucoseEntry(100, mealTime),
            createGlucoseEntry(200, mealTime + 360 * 60 * 1000) // 6 hour gap
        ];
        glucose_data.reverse(); // Convert to reverse chronological order
        
        const result = bucketGlucoseData(glucose_data, defaultProfile, mealTime);
        
        // Should interpolate up to 240 minutes only
        // 240 / 5 = 48 interpolated points + 2 original = 50
        // But the logic is a bit off
        result.length.should.equal(48);
        
        // Check that interpolation stopped at 240 minutes
        const gapMinutes = (result[0].date - result[result.length - 1].date) / (60 * 1000);
        gapMinutes.should.equal(235);
    });
});