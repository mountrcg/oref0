'use strict';

require('should');
const moment = require('moment');
const calcTempTreatments = require('../lib/iob/history').calcTempTreatments;

describe('Calculate Temp Treatments', function() {
    // Helper function to create a basic basal profile
    function createBasicBasalProfile() {
        return [{
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];
    }

    it('should calculate temp basals with defaults', function() {
        const basalprofile = createBasicBasalProfile();
        
        const now = moment().startOf('day').add(30, 'minutes').toDate();
        const timestamp = new Date(now).toISOString();
        const timestamp30mAgo = new Date(now - (30 * 60 * 1000));

        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'TempBasal',
                rate: 2,
                date: timestamp30mAgo.getTime(),
                timestamp: timestamp30mAgo.toISOString()
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp30mAgo.getTime(),
                timestamp: timestamp30mAgo.toISOString()
            }],
            profile: {
                current_basal: 1,
                max_daily_basal: 1,
                dia: 3,
                basalprofile: basalprofile,
                suspend_zeros_iob: false
            }
        };

        const treatments = calcTempTreatments(inputs);
        
        // Filter temp basals (excluding zero temps)
        const tempBasals = treatments.filter(t => t.rate !== undefined);
        tempBasals.should.be.an.Array();
        tempBasals.length.should.equal(3); // Original temp plus two zero temps

        // First entry should be actual temp basal
        tempBasals[0].rate.should.equal(2);
        tempBasals[0].duration.should.equal(30);

        // Following entries should be zero temps
        tempBasals[1].rate.should.equal(0);
        tempBasals[1].duration.should.equal(0);
        tempBasals[2].rate.should.equal(0);
        tempBasals[2].duration.should.equal(0);

        // 30m at 2 U/h - 1U/h -> 0.5U
        const tempBoluses = treatments.filter(t => t.insulin !== undefined);
        const totalInsulin = tempBoluses.reduce((sum, bolus) => sum + bolus.insulin, 0);
        totalInsulin.should.be.approximately(0.5, 0.01);
    });

    it('should handle overlapping temp basals', function() {
        const basalprofile = createBasicBasalProfile();

        const now = moment().startOf('day').add(30, 'minutes').toDate();
        const timestamp = new Date(now).toISOString();
        const timestamp30mAgo = new Date(now - (30 * 60 * 1000));
        const timestamp15mAgo = new Date(now - (15 * 60 * 1000));

        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'TempBasal',
                rate: 2,
                date: timestamp30mAgo.getTime(),
                timestamp: timestamp30mAgo.toISOString()
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp30mAgo.getTime(),
                timestamp: timestamp30mAgo.toISOString()
            }, {
                _type: 'TempBasal',
                rate: 3,
                date: timestamp15mAgo.getTime(),
                timestamp: timestamp15mAgo.toISOString()
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp15mAgo.getTime(),
                timestamp: timestamp15mAgo.toISOString()
            }].reverse(),
            profile: {
                current_basal: 1,
                max_daily_basal: 1,
                dia: 3,
                basalprofile: basalprofile,
                suspend_zeros_iob: false
            }
        };

        const treatments = calcTempTreatments(inputs);
        
        // in this case, the JS returns an incorrect adjusted tempBasal set
        // so we rely on counting the basals only
        // net 1 U/h for 15m and 2 U/h for 15m -> 0.75 U
        // but there is buggy rounding behavior so the answer will
        // be 0.8
        const tempBoluses = treatments.filter(t => t.insulin !== undefined);
        const totalInsulin = tempBoluses.reduce((sum, bolus) => sum + bolus.insulin, 0);
        totalInsulin.should.be.approximately(0.8, 0.01);
    });

    it('should handle pump suspends and resumes', function() {
        const basalprofile = createBasicBasalProfile();

        const now = moment().startOf('day').add(30, 'minutes').toDate();
        const timestamp = new Date(now).toISOString();
        const timestamp30mAgo = new Date(now - (30 * 60 * 1000));
        const timestamp15mAgo = new Date(now - (15 * 60 * 1000));

        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'TempBasal',
                rate: 2,
                date: timestamp30mAgo.getTime(),
                timestamp: timestamp30mAgo.toISOString()
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp30mAgo.getTime(),
                timestamp: timestamp30mAgo.toISOString()
            }, {
                _type: 'PumpSuspend',
                date: timestamp15mAgo.getTime(),
                timestamp: timestamp15mAgo.toISOString()
            }, {
                _type: 'PumpResume',
                date: now,
                timestamp: timestamp
            }].reverse(),
            profile: {
                current_basal: 1,
                max_daily_basal: 1,
                dia: 3,
                basalprofile: basalprofile,
                suspend_zeros_iob: true
            }
        };

        const treatments = calcTempTreatments(inputs);
        
        // Original temp should exist but be shortened
        const origTemp = treatments.find(t => t.rate === 2);
        should.exist(origTemp);
        origTemp.duration.should.equal(15);

        // 15m at 2U/h - 1U/h -> 0.25U
        // 15m at 0U/h - 1U/h -> -0.25U
        // Total: 0
        const tempBoluses = treatments.filter(t => t.insulin !== undefined);
        const totalInsulin = tempBoluses.reduce((sum, bolus) => sum + bolus.insulin, 0);
        totalInsulin.should.be.approximately(0.0, 0.01);
    });

    it('should handle basal profile changes', function() {
        const basalprofile = [{
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }, {
            'start': '00:30:00',
            'rate': 2,
            'minutes': 30
        }];

        const startingPoint = moment('2016-06-13 00:00:00.000').toDate();
        const endingPoint = moment('2016-06-13 00:45:00.000').toDate();

        const inputs = {
            clock: endingPoint.toISOString(),
            history: [{
                _type: 'TempBasal',
                rate: 3,
                date: startingPoint.getTime(),
                timestamp: startingPoint.toISOString()
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 60,
                date: startingPoint.getTime(),
                timestamp: startingPoint.toISOString()
            }].reverse(),
            profile: {
                current_basal: 1,
                max_daily_basal: 2,
                dia: 3,
                basalprofile: basalprofile,
                suspend_zeros_iob: false
            }
        };

        const treatments = calcTempTreatments(inputs);
        const tempBasals = treatments.filter(t => t.rate && t.rate !== 0 && t.duration > 0);
        tempBasals.should.be.an.Array();
        tempBasals.length.should.be.greaterThan(0);

        // Should have rate of 3
        tempBasals[0].rate.should.equal(3);

        // 30m at 3 U/h - 1 U/h -> 1U
        // 15m at 3 U/h - 2 U/h - 0.25U
        // 1.25U total
        const tempBoluses = treatments.filter(t => t.insulin !== undefined);
        const totalInsulin = tempBoluses.reduce((sum, bolus) => sum + bolus.insulin, 0);
        totalInsulin.should.be.approximately(1.25, 0.01);
    });

    it('should properly record boluses', function() {
        const basalprofile = createBasicBasalProfile();
        const now = moment().startOf('day').add(30, 'minutes').toDate();
        const timestamp = new Date(now).toISOString();

        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'Bolus',
                amount: 2,
                date: now,
                timestamp: timestamp
            }],
            profile: {
                current_basal: 1,
                max_daily_basal: 1,
                dia: 3,
                basalprofile: basalprofile,
                suspend_zeros_iob: false
            }
        };

        const treatments = calcTempTreatments(inputs);
        const boluses = treatments.filter(t => t.insulin !== undefined);
        boluses.should.be.an.Array();
        boluses.length.should.equal(1);
        boluses[0].insulin.should.equal(2);
    });

    it('should add zero temp with specified duration', function() {
        const basalprofile = createBasicBasalProfile();

        const now = moment().startOf('day').add(30, 'minutes').toDate();
        const timestamp = new Date(now).toISOString();
        const timestamp30mAgo = new Date(now - (30 * 60 * 1000));

        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'TempBasal',
                rate: 2,
                date: timestamp30mAgo.getTime(),
                timestamp: timestamp30mAgo.toISOString()
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp30mAgo.getTime(),
                timestamp: timestamp30mAgo.toISOString()
            }].reverse(),
            profile: {
                current_basal: 1,
                max_daily_basal: 1,
                dia: 3,
                basalprofile: basalprofile,
                suspend_zeros_iob: false
            }
        };

        // Test with 120 min zero temp duration
        const treatments = calcTempTreatments(inputs, 120);

        // Get only the zero temps
        const zeroTemps = treatments.filter(t => t.rate === 0 && t.duration > 0);
        zeroTemps.should.be.an.Array();
        zeroTemps.length.should.be.greaterThan(0);

        // Verify zero temp duration
        const duration = zeroTemps.reduce((sum, temp) => sum + temp.duration, 0);
        duration.should.equal(120);

        // Verify zero temp starts 1 min in future
        const expectedStart = new Date(now.getTime() + (60 * 1000)); // 1 minute in future
        zeroTemps[0].date.should.equal(expectedStart.getTime());

        // 30m at 2U/h - 1U/h -> 0.5
        // 120m at 0U/h - 1U/h -> -2.0
        // Total -> -1.5U
        const tempBoluses = treatments.filter(t => t.insulin !== undefined);
        const totalInsulin = tempBoluses.reduce((sum, bolus) => sum + bolus.insulin, 0);
        totalInsulin.should.be.approximately(-1.5, 0.01);
    });

    it('should handle zero temp with basal profile changes', function() {
        const basalprofile = [{
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }, {
            'start': '00:30:00',
            'rate': 2,
            'minutes': 30
        }];

        const startingPoint = moment('2016-06-13 00:00:00.000').toDate();
        const now = moment('2016-06-13 01:00:00.000').toDate();
        const timestamp = startingPoint.toISOString();

        const inputs = {
            clock: now.toISOString(),
            history: [{
                _type: 'TempBasal',
                rate: 3,
                date: startingPoint.getTime(),
                timestamp: timestamp
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 60,
                date: startingPoint.getTime(),
                timestamp: timestamp
            }].reverse(),
            profile: {
                current_basal: 1,
                max_daily_basal: 2,
                dia: 3,
                basalprofile: basalprofile,
                suspend_zeros_iob: false
            }
        };

        // Test with 90 min zero temp duration
        const treatments = calcTempTreatments(inputs, 90);

        // Get zero temps
        const zeroTemps = treatments.filter(t => t.rate === 0 && t.duration > 0);
        zeroTemps.should.be.an.Array();
        zeroTemps.length.should.be.greaterThan(0);

        // Verify zero temp duration
        const duration = zeroTemps.reduce((sum, temp) => sum + temp.duration, 0);
        duration.should.equal(90);

        const expectedStart = new Date(startingPoint.getTime() + (61 * 60 * 1000)); // 61 minutes in future
        new Date(zeroTemps[0].date).getTime().should.equal(expectedStart.getTime());

        // 30m at 3U/h - 1U/h -> 1U
        // 30m at 3U/h - 2U/h -> 0.5U
        // 90m at 0U/h - 2U/h -> -3U
        // Total: -1.5U
        const tempBoluses = treatments.filter(t => t.insulin !== undefined);
        const totalInsulin = tempBoluses.reduce((sum, bolus) => sum + bolus.insulin, 0);
        totalInsulin.should.be.approximately(-1.5, 0.01);
    });

    it('should add zero temp when suspended', function() {
        const basalprofile = createBasicBasalProfile();

        const now = moment().startOf('day').add(30, 'minutes').toDate();
        const timestamp = new Date(now).toISOString();
        const timestamp30mAgo = new Date(now.getTime() - (30 * 60 * 1000));
        const timestamp15mAgo = new Date(now.getTime() - (15 * 60 * 1000));

        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'TempBasal',
                rate: 2,
                date: timestamp30mAgo.getTime(),
                timestamp: timestamp30mAgo.toISOString()
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp30mAgo.getTime(),
                timestamp: timestamp30mAgo.toISOString()
            }, {
                _type: 'PumpSuspend',
                date: timestamp15mAgo.getTime(),
                timestamp: timestamp15mAgo.toISOString()
            }].reverse(),
            profile: {
                current_basal: 1,
                max_daily_basal: 1,
                dia: 3,
                basalprofile: basalprofile,
                suspend_zeros_iob: true
            }
        };

        // Test with 60 min zero temp duration
        const treatments = calcTempTreatments(inputs, 60);
        //console.log(treatments);
	
        const tempBasals = treatments.filter(t => t.rate !== undefined);
        tempBasals[0].duration.should.equal(15);
        tempBasals[0].timestamp.should.equal(timestamp30mAgo.toISOString());
        tempBasals[0].rate.should.equal(2);

        // 15m at 2U/h - 1U/h -> 0.25U
        // 15m at 0U/h - 1U/h -> -0.25U
        // 60m at 0U/h - 1U/h -> -1
        // Total: -1U
        const tempBoluses = treatments.filter(t => t.insulin !== undefined);
        const totalInsulin = tempBoluses.reduce((sum, bolus) => sum + bolus.insulin, 0);
        totalInsulin.should.be.approximately(-1.0, 0.01);
    });

    it('should split at basal rate change even with duration > 30', function() {
        // Basal profile that changes from 1.0 to 2.0 at 00:15
        const basalprofile = [{
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }, {
            'start': '00:15:00',  // Basal rate change at 15 minutes
            'rate': 2,
            'minutes': 15
        }];
    
        // Start a 45-minute temp basal at 00:00
        const startingPoint = moment('2016-06-13 00:00:00.000').toDate();
        const endingPoint = moment('2016-06-13 00:45:00.000').toDate();
    
        const inputs = {
            clock: endingPoint.toISOString(),
            history: [{
                _type: 'TempBasal',
                rate: 3,  // 3.0 U/hr temp basal
                date: startingPoint.getTime(),
                timestamp: startingPoint.toISOString()
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 45,  // Longer than 30 minutes
                date: startingPoint.getTime(),
                timestamp: startingPoint.toISOString()
            }].reverse(),
            profile: {
                current_basal: 1,
                max_daily_basal: 2,
                dia: 3,
                basalprofile: basalprofile,
                suspend_zeros_iob: false
            }
        };
    
        const treatments = calcTempTreatments(inputs);
        //console.log(treatments);

        // Calculate expected insulin impact
        // Should be:
        // First 15 mins: (3 U/hr - 1 U/hr) * 0.25 hr = 0.5U
        // Next 30 mins: (3 U/hr - 2 U/hr) * 0.5 hr = 0.5U
        // Total should be 1.0U
        const tempBoluses = treatments.filter(t => t.insulin !== undefined);
        const totalInsulin = tempBoluses.reduce((sum, bolus) => sum + bolus.insulin, 0);
        totalInsulin.should.be.approximately(1.0, 0.01); // This will fail due to bug
    });

    it('should calculate treatments using a real pump history', function() {
        const fs = require('fs');
        const path = require('path');
        const filePath = path.join(__dirname, 'js_iob_input_error.json');
        const jsonString = fs.readFileSync(filePath, 'utf8');
        const iobInputs = JSON.parse(jsonString);

        var now = new Date(iobInputs.clock),
            timestamp = new Date(now).toISOString(),
            inputs = {
                clock: timestamp,
                history: iobInputs.history,
                profile: iobInputs.profile,
                autosens: iobInputs.autosens
            };

	var treatments = calcTempTreatments(inputs);
	//console.log(treatments);
	const outFilePath = path.join(__dirname, 'js_treatments.json');
	fs.writeFileSync(outFilePath, JSON.stringify(treatments, null, 2), 'utf8');
    });
});
