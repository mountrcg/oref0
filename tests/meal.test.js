'use strict';

var should = require('should');
const moment = require('moment');
var tz = require('moment-timezone');

describe('meal/history', function() {
    var find_meal_inputs = require('../lib/meal/history');
    
    it('should process carbs from carbHistory', function() {
        var inputs = {
            history: [],
            carbs: [
                {"_type": "Carb Entry", "created_at": "2016-06-19T12:00:00-04:00", "carbs": 20}
            ],
            profile: {}
        };
        
        var output = find_meal_inputs(inputs);
        output.length.should.equal(1);
        output[0].carbs.should.equal(20);
        output[0].nsCarbs.should.equal(20);
        output[0].timestamp.should.equal("2016-06-19T12:00:00-04:00");
    });
    
    it('should process bolus events from pumpHistory', function() {
        var inputs = {
            history: [
                {"_type": "Bolus", "timestamp": "2016-06-19T12:00:00-04:00", "amount": 2.5}
            ],
            carbs: [],
            profile: {}
        };
        
        var output = find_meal_inputs(inputs);
        output.length.should.equal(1);
        output[0].bolus.should.equal(2.5);
        output[0].timestamp.should.equal("2016-06-19T12:00:00-04:00");
    });
    
    it('should handle both carbs and bolus entries', function() {
        var inputs = {
            history: [
                {"_type": "Bolus", "timestamp": "2016-06-19T12:00:00-04:00", "amount": 2.5}
            ],
            carbs: [
                {"_type": "Carb Entry", "created_at": "2016-06-19T12:30:00-04:00", "carbs": 20}
            ],
            profile: {}
        };
        
        var output = find_meal_inputs(inputs);
        output.length.should.equal(2);
	    output[0].carbs.should.equal(20);
        output[1].bolus.should.equal(2.5);
    });
    
    it('should dedupe carb entries with same timestamp', function() {
        var inputs = {
            history: [],
            carbs: [
                {"_type": "Carb Entry", "created_at": "2016-06-19T12:00:00-04:00", "carbs": 20},
                {"_type": "Carb Entry", "created_at": "2016-06-19T12:00:00-04:00", "carbs": 30}
            ],
            profile: {}
        };
        
        var output = find_meal_inputs(inputs);
        output.length.should.equal(1);
        output[0].carbs.should.equal(20);
    });
    
    it('should dedupe bolus entries with same timestamp', function() {
        var inputs = {
            history: [
                {"_type": "Bolus", "timestamp": "2016-06-19T12:00:00-04:00", "amount": 2.5},
                {"_type": "Bolus", "timestamp": "2016-06-19T12:00:00-04:00", "amount": 3.0}
            ],
            carbs: [],
            profile: {}
        };
        
        var output = find_meal_inputs(inputs);
        output.length.should.equal(1);
        output[0].bolus.should.equal(2.5);
    });
    
    it('should consider timestamps within 2 seconds as duplicates', function() {
        var inputs = {
            history: [
                {"_type": "Bolus", "timestamp": "2016-06-19T12:00:00-04:00", "amount": 2.5},
                {"_type": "Bolus", "timestamp": "2016-06-19T12:00:01-04:00", "amount": 3.0}
            ],
            carbs: [],
            profile: {}
        };
        
        var output = find_meal_inputs(inputs);
        output.length.should.equal(1);
        output[0].bolus.should.equal(2.5);
    });
});

describe('meal/total', function() {
    var recentCarbs = require('../lib/meal/total');

    it('should calculate carb absorption correctly', function() {
        const baseTime = moment('2016-06-19 12:00:00').toDate();
        const mealTime = moment('2016-06-19 12:00:00').toDate();
        const testTime = moment('2016-06-19 13:00:00').toDate(); // 1 hour after meal
        
        // Create glucose data showing rise after carbs
        var glucoseData = [];
        
        // Create a series of glucose readings every 5 minutes
        for (var i = 0; i < 13; i++) {
            // Create pattern that shows carb impact:
            // Initial flat, then rise, then plateau
            var bg = 100;
            if (i > 2 && i < 8) {
                bg = 100 + ((i-2) * 10); // 100, 110, 120, 130, 140
            } else if (i >= 8) {
                bg = 150; // plateau
            }
            
            var timestamp = baseTime.getTime() + (i * 5 * 60 * 1000);
            var dateStr = new Date(timestamp).toISOString();
            
            glucoseData.push({
                type: 'svg',
                svg: bg,
                glucose: bg,
                date: timestamp,
                dateString: dateStr
            });
        }
        glucoseData.reverse();

        // Create insulin data - bolus at same time as carbs
        var pumpHistory = [
            {
                "_type": "Bolus",
                "timestamp": moment(mealTime).toISOString(),
                "amount": 3.0,
                "duration": 0
            }
        ];
        
        // Carb treatment 
        var treatments = [
            { timestamp: moment(mealTime).toISOString(), carbs: 30, nsCarbs: 30 },
            { timestamp: moment(mealTime).toISOString(), bolus: 3 }
        ];
        
        var profile = {
            dia: 4,  // 4 hour insulin duration
            maxMealAbsorptionTime: 6,
            maxCOB: 120,
            min_5m_carbimpact: 3,
            carb_ratio: 10,  // 10g per unit
            isfProfile: {
                sensitivities: [{ offset: 0, sensitivity: 40 }]  // 40 mg/dL per unit
            },
            current_basal: 1.0,
            carbAbsorptionRate: 30  // 30g per hour
        };

        var opts = {
            treatments: treatments,
            profile: profile,
            pumphistory: pumpHistory,
            glucose: glucoseData,
            basalprofile: [{ minutes: 0, rate: 1.0 }]
        };
        
        // After 1 hour, we should see partial carb absorption
        var result = recentCarbs(opts, testTime);

        // Check that mealCOB exists and is correctly calculated
        result.should.have.property('mealCOB');
        result.should.have.property('currentDeviation');
        result.currentDeviation.should.equal(3);
        result.mealCOB.should.equal(12);
    });

    it('should return empty object when no treatments provided', function() {
        var baseTime = new Date("2016-06-19T13:00:00-04:00").getTime();
        var glucoseData = [
            { 
                glucose: 100, 
                date: baseTime,
                dateString: "2016-06-19T13:00:00-04:00"
            }
        ];
        
        var opts = {
            treatments: null,
            profile: {
                maxMealAbsorptionTime: 6,
                maxCOB: 120,
                timezone: "America/New_York",
                min_5m_carbimpact: 3,
                carb_ratio: 10,
                isfProfile: {
                    sensitivities: [{ offset: 0, sensitivity: 40 }]
                },
                current_basal: 1.0
            },
            pumphistory: [],
            glucose: glucoseData,
            basalprofile: [{ minutes: 0, rate: 1.0 }]
        };
        
        var time = new Date(tz("2016-06-19T13:00:00-04:00"));
        var result = recentCarbs(opts, time);
        
        Object.keys(result).length.should.equal(0);
    });
    
    it('should calculate carbs correctly for treatments within the meal window', function() {
        var treatments = [
            {
                timestamp: "2016-06-19T12:00:00-04:00",
                carbs: 20,
                nsCarbs: 20
            }
        ];
        
        var baseTime = new Date("2016-06-19T12:00:00-04:00").getTime();
        var glucoseData = [
            { 
                glucose: 110, 
                date: baseTime + 60 * 60 * 1000,
                dateString: "2016-06-19T13:00:00-04:00"
            },
            { 
                glucose: 105, 
                date: baseTime + 30 * 60 * 1000,
                dateString: "2016-06-19T12:30:00-04:00"
            },
            { 
                glucose: 100, 
                date: baseTime,
                dateString: "2016-06-19T12:00:00-04:00"
            }
        ];
        
        var opts = {
            treatments: treatments,
            profile: {
                maxMealAbsorptionTime: 6,
                maxCOB: 120,
                timezone: "America/New_York",
                min_5m_carbimpact: 3,
                carb_ratio: 10,
                isfProfile: {
                    sensitivities: [{ offset: 0, sensitivity: 40 }]
                },
                current_basal: 1.0
            },
            pumphistory: [],
            glucose: glucoseData,
            basalprofile: [{ minutes: 0, rate: 1.0 }]
        };
        
        var time = new Date(tz("2016-06-19T13:00:00-04:00"));
        var result = recentCarbs(opts, time);

        result.carbs.should.equal(20);
        result.nsCarbs.should.equal(20);
        result.currentDeviation.should.equal(0.67);
        result.mealCOB.should.equal(14);
    });
    
    it('should ignore treatments outside the meal window', function() {
        var treatments = [
            {
                timestamp: "2016-06-19T06:00:00-04:00", // 7 hours before time
                carbs: 20,
                nsCarbs: 20
            }
        ];
        
        var baseTime = new Date("2016-06-19T12:00:00-04:00").getTime();
        var glucoseData = [
            { 
                glucose: 110, 
                date: baseTime + 60 * 60 * 1000,
                dateString: "2016-06-19T13:00:00-04:00"
            },
            { 
                glucose: 105, 
                date: baseTime + 30 * 60 * 1000,
                dateString: "2016-06-19T12:30:00-04:00"
            },
            { 
                glucose: 100, 
                date: baseTime,
                dateString: "2016-06-19T12:00:00-04:00"
            }
        ];
        
        var opts = {
            treatments: treatments,
            profile: {
                maxMealAbsorptionTime: 6, // 6 hour window
                maxCOB: 120,
                timezone: "America/New_York",
                min_5m_carbimpact: 3,
                carb_ratio: 10,
                isfProfile: {
                    sensitivities: [{ offset: 0, sensitivity: 40 }]
                },
                current_basal: 1.0
            },
            pumphistory: [],
            glucose: glucoseData,
            basalprofile: [{ minutes: 0, rate: 1.0 }]
        };
        
        var time = new Date(tz("2016-06-19T13:00:00-04:00"));
        var result = recentCarbs(opts, time);
        result.carbs.should.equal(0);
        result.mealCOB.should.equal(0);
        result.currentDeviation.should.equal(0.67);
    });
    
    it('should respect maxMealAbsorptionTime from profile', function() {
        var treatments = [
            {
                timestamp: "2016-06-19T10:00:00-04:00", // 3 hours before time
                carbs: 20,
                nsCarbs: 20
            }
        ];
        
        var baseTime = new Date("2016-06-19T12:00:00-04:00").getTime();
        var glucoseData = [
            { 
                glucose: 110, 
                date: baseTime + 60 * 60 * 1000,
                dateString: "2016-06-19T13:00:00-04:00"
            },
            { 
                glucose: 105, 
                date: baseTime + 30 * 60 * 1000,
                dateString: "2016-06-19T12:30:00-04:00"
            },
            { 
                glucose: 100, 
                date: baseTime,
                dateString: "2016-06-19T12:00:00-04:00"
            }
        ];
        
        var opts = {
            treatments: treatments,
            profile: {
                maxMealAbsorptionTime: 2, // 2 hour window
                maxCOB: 120,
                timezone: "America/New_York",
                min_5m_carbimpact: 3,
                carb_ratio: 10,
                isfProfile: {
                    sensitivities: [{ offset: 0, sensitivity: 40 }]
                },
                current_basal: 1.0
            },
            pumphistory: [],
            glucose: glucoseData,
            basalprofile: [{ minutes: 0, rate: 1.0 }]
        };
        
        var time = new Date(tz("2016-06-19T13:00:00-04:00"));
        var result = recentCarbs(opts, time);
        result.carbs.should.equal(0);
        result.mealCOB.should.equal(0);
    });
    
    it('should respect maxCOB from profile', function() {
        var treatments = [
            {
                timestamp: "2016-06-19T12:00:00-04:00",
                carbs: 200,
                nsCarbs: 200
            }
        ];
        
        var baseTime = new Date("2016-06-19T12:00:00-04:00").getTime();
        var glucoseData = [
            { 
                glucose: 110, 
                date: baseTime + 60 * 60 * 1000,
                dateString: "2016-06-19T13:00:00-04:00"
            },
            { 
                glucose: 105, 
                date: baseTime + 30 * 60 * 1000,
                dateString: "2016-06-19T12:30:00-04:00"
            },
            { 
                glucose: 100, 
                date: baseTime,
                dateString: "2016-06-19T12:00:00-04:00"
            }
        ];
        
        var opts = {
            treatments: treatments,
            profile: {
                maxMealAbsorptionTime: 6,
                maxCOB: 120,
                timezone: "America/New_York",
                min_5m_carbimpact: 3,
                carb_ratio: 10,
                isfProfile: {
                    sensitivities: [{ offset: 0, sensitivity: 40 }]
                },
                current_basal: 1.0
            },
            pumphistory: [],
            glucose: glucoseData,
            basalprofile: [{ minutes: 0, rate: 1.0 }]
        };
        
        var time = new Date(tz("2016-06-19T13:00:00-04:00"));
        var result = recentCarbs(opts, time);

        result.should.have.property('mealCOB');
        result.mealCOB.should.be.lessThanOrEqual(120);
    });
});
