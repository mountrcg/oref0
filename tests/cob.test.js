'use strict';

var should = require('should');
const moment = require('moment');
var tz = require('moment-timezone');

describe('determine-basal/cob', function() {
    var detectCarbAbsorption = require('../lib/determine-basal/cob');
    
    // Helper function to create mock glucose data
    function createGlucoseData(startTime, values, intervalMinutes = 5) {
        return values.map((glucose, i) => {
            const timestamp = startTime + (i * intervalMinutes * 60 * 1000);
            return {
                glucose: glucose,
                sgv: glucose,
                date: timestamp,
                dateString: new Date(timestamp).toISOString()
            };
        }).reverse();
    }
    
    // Helper function to create mock IOB inputs
    function createMockIOBInputs(profile) {
        return {
            profile: profile || {
                dia: 4,
                maxMealAbsorptionTime: 6,
                min_5m_carbimpact: 3,
                carb_ratio: 10,
                isfProfile: {
                    sensitivities: [{ offset: 0, sensitivity: 40 }]
                },
                current_basal: 1.0
            },
            history: []
        };
    }
    
    // Helper function to create mock inputs
    function createMockInputs(glucose_data, mealTime, ciTime, profile) {
        return {
            glucose_data: glucose_data,
            iob_inputs: createMockIOBInputs(profile),
            basalprofile: [{ minutes: 0, rate: 1.0 }],
            mealTime: mealTime,
            ciTime: ciTime
        };
    }

    it('should detect carb absorption with rising glucose', function() {
        const mealTime = moment('2016-06-19 12:00:00').valueOf();
        const ciTime = moment('2016-06-19 13:00:00').valueOf();
        
        // Create glucose data showing significant rise after meal - needs enough points for calculations
        var glucose_data = [
            { glucose: 100, sgv: 100, date: mealTime, dateString: new Date(mealTime).toISOString()},
            { glucose: 105, sgv: 105, date: mealTime + 5*60*1000, dateString: new Date(mealTime + 5*60*1000).toISOString()},
            { glucose: 110, sgv: 110, date: mealTime + 10*60*1000, dateString: new Date(mealTime + 10*60*1000).toISOString()},
            { glucose: 115, sgv: 115, date: mealTime + 15*60*1000, dateString: new Date(mealTime + 15*60*1000).toISOString()},
            { glucose: 120, sgv: 120, date: mealTime + 20*60*1000, dateString: new Date(mealTime + 20*60*1000).toISOString()},
            { glucose: 130, sgv: 130, date: mealTime + 25*60*1000, dateString: new Date(mealTime + 25*60*1000).toISOString()},
            { glucose: 140, sgv: 140, date: mealTime + 30*60*1000, dateString: new Date(mealTime + 30*60*1000).toISOString()},
            { glucose: 150, sgv: 150, date: mealTime + 35*60*1000, dateString: new Date(mealTime + 35*60*1000).toISOString()},
            { glucose: 155, sgv: 155, date: mealTime + 40*60*1000, dateString: new Date(mealTime + 40*60*1000).toISOString()},
            { glucose: 160, sgv: 160, date: mealTime + 45*60*1000, dateString: new Date(mealTime + 45*60*1000).toISOString()},
            { glucose: 160, sgv: 160, date: mealTime + 50*60*1000, dateString: new Date(mealTime + 50*60*1000).toISOString()},
            { glucose: 160, sgv: 160, date: mealTime + 55*60*1000, dateString: new Date(mealTime + 55*60*1000).toISOString()},
            { glucose: 160, sgv: 160, date: mealTime + 60*60*1000, dateString: new Date(mealTime + 60*60*1000).toISOString()}
        ];
        glucose_data.reverse();

        var inputs = createMockInputs(glucose_data, mealTime, ciTime);
        var result = detectCarbAbsorption(inputs);
        result.carbsAbsorbed.should.equal(9.75);

        // now again without a ciTime
        inputs = createMockInputs(glucose_data, mealTime);
        result = detectCarbAbsorption(inputs);
        result.carbsAbsorbed.should.equal(14.75);
    });

    it('should handle stable glucose (no carb absorption)', function() {
        const mealTime = moment('2016-06-19 12:00:00').valueOf();
        const ciTime = moment('2016-06-19 13:00:00').valueOf();
        
        // Create stable glucose data with multiple readings
        var glucose_data = [
            { glucose: 100, sgv: 100, date: mealTime, dateString: new Date(mealTime).toISOString()},
            { glucose: 100, sgv: 100, date: mealTime + 5*60*1000, dateString: new Date(mealTime + 5*60*1000).toISOString()},
            { glucose: 100, sgv: 100, date: mealTime + 10*60*1000, dateString: new Date(mealTime + 10*60*1000).toISOString()},
            { glucose: 100, sgv: 100, date: mealTime + 15*60*1000, dateString: new Date(mealTime + 15*60*1000).toISOString()},
            { glucose: 100, sgv: 100, date: mealTime + 20*60*1000, dateString: new Date(mealTime + 20*60*1000).toISOString()},
            { glucose: 100, sgv: 100, date: mealTime + 30*60*1000, dateString: new Date(mealTime + 30*60*1000).toISOString()}
        ];
        glucose_data.reverse();
        
        const inputs = createMockInputs(glucose_data, mealTime, ciTime);
        const result = detectCarbAbsorption(inputs);
        
        result.carbsAbsorbed.should.equal(0);
    });

    it('should handle falling glucose (negative deviation)', function() {
        const mealTime = moment('2016-06-19 12:00:00').valueOf();
        const ciTime = moment('2016-06-19 13:00:00').valueOf();
        
        // Create falling glucose data: 150 -> 100
        var glucose_data = [
            { glucose: 150, sgv: 150, date: mealTime, dateString: new Date(mealTime).toISOString()},
            { glucose: 145, sgv: 145, date: mealTime + 5*60*1000, dateString: new Date(mealTime + 5*60*1000).toISOString()},
            { glucose: 140, sgv: 140, date: mealTime + 10*60*1000, dateString: new Date(mealTime + 10*60*1000).toISOString()},
            { glucose: 135, sgv: 135, date: mealTime + 15*60*1000, dateString: new Date(mealTime + 15*60*1000).toISOString()},
            { glucose: 130, sgv: 130, date: mealTime + 20*60*1000, dateString: new Date(mealTime + 20*60*1000).toISOString()},
            { glucose: 125, sgv: 125, date: mealTime + 30*60*1000, dateString: new Date(mealTime + 30*60*1000).toISOString()}
        ];
        glucose_data.reverse();
        
        const inputs = createMockInputs(glucose_data, mealTime, ciTime);
        const result = detectCarbAbsorption(inputs);
        result.carbsAbsorbed.should.equal(0); // No carbs absorbed when glucose is falling
    });



    it('should stop processing when pre-meal BG is found', function() {
        const mealTime = moment('2016-06-19 12:00:00').valueOf();
        const ciTime = moment('2016-06-19 13:00:00').valueOf();
        
        // Include glucose data from before meal time
        let glucose_data = [
            {
                glucose: 150,
                date: mealTime + 60 * 60 * 1000, // 1 hour after meal
                dateString: new Date(mealTime + 60 * 60 * 1000).toISOString()
            },
            {
                glucose: 120,
                date: mealTime + 30 * 60 * 1000, // 30 minutes after meal
                dateString: new Date(mealTime + 30 * 60 * 1000).toISOString()
            },
            {
                glucose: 100,
                date: mealTime - 30 * 60 * 1000, // 30 minutes before meal (pre-meal)
                dateString: new Date(mealTime - 30 * 60 * 1000).toISOString()
            }
        ];
        
        const inputs = createMockInputs(glucose_data, mealTime, ciTime);
        const result = detectCarbAbsorption(inputs);
        result.carbsAbsorbed.should.equal(3.75);
    });

    it('should respect maxMealAbsorptionTime', function() {
        const mealTime = moment('2016-06-19 12:00:00-04:00').valueOf();
        const ciTime = moment('2016-06-19 13:00:00-04:00').valueOf();
        
        // Create glucose data spanning longer than maxMealAbsorptionTime
        const glucoseValues = [];
        for (let i = 0; i < 100; i++) { // 100 * 5 minutes = ~8 hours
            glucoseValues.push(Math.trunc(100 + Math.sin(i * 0.1) * 20)); // Sinusoidal pattern
        }
        const glucose_data = createGlucoseData(mealTime - 2 * 60 * 60 * 1000, glucoseValues); // Start 2 hours before meal
        
        const profile = {
            dia: 4,
            maxMealAbsorptionTime: 2, // Only 2 hours
            min_5m_carbimpact: 3,
            carb_ratio: 10,
            isfProfile: {
                sensitivities: [{ offset: 0, sensitivity: 40 }]
            },
            current_basal: 1.0
        };
        
        const inputs = createMockInputs(glucose_data, mealTime, ciTime, profile);
        const result = detectCarbAbsorption(inputs);
        result.carbsAbsorbed.should.equal(40.5);
    });

    it('should handle minimum carb impact from profile', function() {
        const mealTime = moment('2016-06-19 12:00:00').valueOf();
        var ciTime;

        // Create glucose data with slight rise to trigger carb absorption
        var glucose_data = [
            { glucose: 100, sgv: 100, date: mealTime, dateString: new Date(mealTime).toISOString()},
            { glucose: 101, sgv: 101, date: mealTime + 5*60*1000, dateString: new Date(mealTime + 5*60*1000).toISOString()},
            { glucose: 102, sgv: 102, date: mealTime + 10*60*1000, dateString: new Date(mealTime + 10*60*1000).toISOString()},
            { glucose: 103, sgv: 103, date: mealTime + 15*60*1000, dateString: new Date(mealTime + 15*60*1000).toISOString()},
            { glucose: 104, sgv: 104, date: mealTime + 20*60*1000, dateString: new Date(mealTime + 20*60*1000).toISOString()},
            { glucose: 105, sgv: 105, date: mealTime + 30*60*1000, dateString: new Date(mealTime + 30*60*1000).toISOString()}
        ];
        glucose_data.reverse();
        
        const profile = {
            dia: 4,
            maxMealAbsorptionTime: 6,
            min_5m_carbimpact: 5, // Higher minimum impact
            carb_ratio: 10,
            isfProfile: {
                sensitivities: [{ offset: 0, sensitivity: 40 }]
            },
            current_basal: 1.0
        };
        
        const inputs = createMockInputs(glucose_data, mealTime, ciTime, profile);
        const result = detectCarbAbsorption(inputs);
        result.carbsAbsorbed.should.equal(3.75);
    });

    
    
});
