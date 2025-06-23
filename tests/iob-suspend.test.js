'use strict';

require('should');
const moment = require('moment');
const calcTempTreatments = require('../lib/iob/history').calcTempTreatments;

describe('Suspend Logic Tests with suspendZerosIob=true', function() {
    // Helper function to create a basic basal profile
    function createBasicBasalProfile() {
        return [{
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];
    }

    // Helper function to create a multi-rate basal profile
    function createMultiRateBasalProfile() {
        return [{
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }, {
            'start': '00:30:00',
            'rate': 2,
            'minutes': 30
        }];
    }

    it('should handle basic suspend and resume', function() {
        const basalprofile = createBasicBasalProfile();
        
        const now = moment('2016-06-13 01:00:00').toDate()
        const timestamp = new Date(now).toISOString();
        const timestamp30mAgo = moment('2016-06-13 00:30:00').toDate();
        const timestamp15mAgo = moment('2016-06-13 00:45:00').toDate();

        const inputs = {
            clock: timestamp,
            history: [
                {
                    _type: 'TempBasal',
                    rate: 2,
                    date: timestamp30mAgo.getTime(),
                    timestamp: timestamp30mAgo.toISOString()
                }, 
                {
                    _type: 'TempBasalDuration',
                    'duration (min)': 30,
                    date: timestamp30mAgo.getTime(),
                    timestamp: timestamp30mAgo.toISOString()
                },
                {
                    _type: 'PumpSuspend',
                    date: timestamp15mAgo.getTime(),
                    timestamp: timestamp15mAgo.toISOString()
                },
                {
                    _type: 'PumpResume',
                    date: now.getTime(),
                    timestamp: timestamp
                }
            ].reverse(),
            profile: {
                current_basal: 1,
                max_daily_basal: 1,
                dia: 3,
                basalprofile: basalprofile,
                suspend_zeros_iob: true
            }
        };

        const treatments = calcTempTreatments(inputs);
        
        // Calculate expected insulin impact:
        // 15m at 2 U/h - 1 U/h = 0.25U 
        // 15m at 0 U/h - 1 U/h = -0.25U
        // Total: 0U
        const tempBoluses = treatments.filter(t => t.insulin !== undefined);
        const totalInsulin = tempBoluses.reduce((sum, bolus) => sum + bolus.insulin, 0);
        totalInsulin.should.be.approximately(0.0, 0.05);
    });

    it('should handle suspend prior to history window', function() {
        const basalprofile = createBasicBasalProfile();
        
        const now = moment('2016-06-13 08:00:00').toDate();
        const timestamp = new Date(now).toISOString();
        const resumeTime = moment('2016-06-13 07:00:00').toDate();
        const tempStartTime = moment('2016-06-13 07:30:00').toDate();

        const inputs = {
            clock: timestamp,
            history: [
                {
                    _type: 'PumpResume',
                    date: resumeTime.getTime(),
                    timestamp: resumeTime.toISOString()
                },
                {
                    _type: 'TempBasal',
                    rate: 2,
                    date: tempStartTime.getTime(),
                    timestamp: tempStartTime.toISOString()
                },
                {
                    _type: 'TempBasalDuration',
                    'duration (min)': 30,
                    date: tempStartTime.getTime(),
                    timestamp: tempStartTime.toISOString()
                }
            ].reverse(),
            profile: {
                current_basal: 1,
                max_daily_basal: 1,
                dia: 10,
                basalprofile: basalprofile,
                suspend_zeros_iob: true
            }
        };

        const treatments = calcTempTreatments(inputs);

        // Calculate expected insulin impact:
        // 7h at 0 U/h - 1U/h = -7
        // 30m at profile basal rate = 0U
        // 30m at 2 U/h - 1 U/h = 0.5U
        // Total: -6.5U
        const tempBoluses = treatments.filter(t => t.insulin !== undefined);
        const totalInsulin = tempBoluses.reduce((sum, bolus) => sum + bolus.insulin, 0);
        // FIXME: come back to this one later
        totalInsulin.should.be.approximately(-6.5, 0.05);
    });

    it('should handle current suspension', function() {
        const basalprofile = createBasicBasalProfile();
        
        const now = moment().startOf('day').add(60, 'minutes').toDate();
        const timestamp = new Date(now).toISOString();
        const suspendTime = new Date(now - (30 * 60 * 1000));
        const tempStartTime = new Date(now - (45 * 60 * 1000));

        const inputs = {
            clock: timestamp,
            history: [
                {
                    _type: 'TempBasal',
                    rate: 2,
                    date: tempStartTime.getTime(),
                    timestamp: tempStartTime.toISOString()
                },
                {
                    _type: 'TempBasalDuration',
                    'duration (min)': 30,
                    date: tempStartTime.getTime(),
                    timestamp: tempStartTime.toISOString()
                },
                {
                    _type: 'PumpSuspend',
                    date: suspendTime.getTime(),
                    timestamp: suspendTime.toISOString()
                }
            ].reverse(),
            profile: {
                current_basal: 1,
                max_daily_basal: 1,
                dia: 3,
                basalprofile: basalprofile,
                suspend_zeros_iob: true
            }
        };

        const treatments = calcTempTreatments(inputs);

        // Calculate expected insulin impact:
        // 15m at 2 U/h - 1U/h = 0.25
        // 30m at 0 U/h - 1U/h = -0.5
        // Total: -0.5U
        const tempBoluses = treatments.filter(t => t.insulin !== undefined);
        const totalInsulin = tempBoluses.reduce((sum, bolus) => sum + bolus.insulin, 0);
        totalInsulin.should.be.approximately(-0.25, 0.05);
    });

    it('should handle multiple suspend-resume cycles', function() {
        const basalprofile = createBasicBasalProfile();
        
        const now = moment().startOf('day').add(90, 'minutes').toDate();
        const timestamp = new Date(now).toISOString();
        
        // Create history with 2 suspend-resume cycles
        const suspend1 = new Date(now - (90 * 60 * 1000));
        const resume1 = new Date(now - (75 * 60 * 1000));
        const tempStart = new Date(now - (60 * 60 * 1000));
        const suspend2 = new Date(now - (45 * 60 * 1000));
        const resume2 = new Date(now - (30 * 60 * 1000));

        const inputs = {
            clock: timestamp,
            history: [
                {
                    _type: 'PumpSuspend',
                    date: suspend1.getTime(),
                    timestamp: suspend1.toISOString()
                },
                {
                    _type: 'PumpResume',
                    date: resume1.getTime(),
                    timestamp: resume1.toISOString()
                },
                {
                    _type: 'TempBasal',
                    rate: 2,
                    date: tempStart.getTime(),
                    timestamp: tempStart.toISOString()
                },
                {
                    _type: 'TempBasalDuration',
                    'duration (min)': 60,
                    date: tempStart.getTime(),
                    timestamp: tempStart.toISOString()
                },
                {
                    _type: 'PumpSuspend',
                    date: suspend2.getTime(),
                    timestamp: suspend2.toISOString()
                },
                {
                    _type: 'PumpResume',
                    date: resume2.getTime(),
                    timestamp: resume2.toISOString()
                }
            ].reverse(),
            profile: {
                current_basal: 1,
                max_daily_basal: 1,
                dia: 3,
                basalprofile: basalprofile,
                suspend_zeros_iob: true
            }
        };

        const treatments = calcTempTreatments(inputs);

        // Calculate expected insulin impact:
        // 15m at 0 U/h - 1 U/h = -0.25
        // 15m at 2 U/h - 1 U/h = 0.25
        // 15m at 0 U/h - 1 U/h = -0.25
        // 30m at 2 U/h - 1 U/h = 0.5
        // Total: 0.25U
        const tempBoluses = treatments.filter(t => t.insulin !== undefined);
        const totalInsulin = tempBoluses.reduce((sum, bolus) => sum + bolus.insulin, 0);
        totalInsulin.should.be.approximately(0.25, 0.05);        
    });

    it('should handle suspend with basal profile changes', function() {
        const basalprofile = createMultiRateBasalProfile();
        
        // Start at 00:15, suspend at 00:30, resume at 00:45
        const startTime = moment('2016-06-13 00:15:00').toDate();
        const suspendTime = moment('2016-06-13 00:30:00').toDate();
        const resumeTime = moment('2016-06-13 00:45:00').toDate();
        const endTime = moment('2016-06-13 01:00:00').toDate();

        const inputs = {
            clock: endTime.toISOString(),
            history: [
                {
                    _type: 'TempBasal',
                    rate: 3,
                    date: startTime.getTime(),
                    timestamp: startTime.toISOString()
                },
                {
                    _type: 'TempBasalDuration',
                    'duration (min)': 45,
                    date: startTime.getTime(),
                    timestamp: startTime.toISOString()
                },
                {
                    _type: 'PumpSuspend',
                    date: suspendTime.getTime(),
                    timestamp: suspendTime.toISOString()
                },
                {
                    _type: 'PumpResume',
                    date: resumeTime.getTime(),
                    timestamp: resumeTime.toISOString()
                }
            ].reverse(),
            profile: {
                current_basal: 1,
                max_daily_basal: 2,
                dia: 3,
                basalprofile: basalprofile,
                suspend_zeros_iob: true
            }
        };

        const treatments = calcTempTreatments(inputs);
        
        // Calculate expected insulin impact:
        // 15m at 3 U/h - 1 U/h = 0.5U (from start to basal change)
        // 15m at 0 U/h - 2 U/h = -0.5U (from basal change and suspend)
        // 15m at 3 U/h - 2 U/h = 0.25U (resume to finish)
        // Total: 0.25U
        const tempBoluses = treatments.filter(t => t.insulin !== undefined);
        const totalInsulin = tempBoluses.reduce((sum, bolus) => sum + bolus.insulin, 0);
        totalInsulin.should.be.approximately(0.25, 0.05);
    });

    it('should properly handle IOB impact with suspends', function() {
        const basalprofile = createBasicBasalProfile();
        
        const now = moment().startOf('day').add(90, 'minutes').toDate();
        const timestamp = new Date(now).toISOString();
        
        // Create a 30m temp at 2x basal, then suspend for 30m, then resume
        const tempStart = new Date(now - (60 * 60 * 1000));
        const suspendTime = new Date(now - (30 * 60 * 1000));
        const resumeTime = new Date(now);

        const inputs = {
            clock: timestamp,
            history: [
                {
                    _type: 'TempBasal',
                    rate: 2,
                    date: tempStart.getTime(),
                    timestamp: tempStart.toISOString()
                },
                {
                    _type: 'TempBasalDuration',
                    'duration (min)': 30,
                    date: tempStart.getTime(),
                    timestamp: tempStart.toISOString()
                },
                {
                    _type: 'PumpSuspend',
                    date: suspendTime.getTime(),
                    timestamp: suspendTime.toISOString()
                },
                {
                    _type: 'PumpResume',
                    date: resumeTime.getTime(),
                    timestamp: resumeTime.toISOString()
                }
            ].reverse(),
            profile: {
                current_basal: 1,
                max_daily_basal: 1,
                dia: 3,
                basalprofile: basalprofile,
                suspend_zeros_iob: true
            }
        };

        const treatments = calcTempTreatments(inputs);
        
        // Calculate expected insulin impact:
        // 30m at 2 U/h - 1 U/h = 0.5U (from temp start to temp end)
        // 30m at 0 U/h - 1 U/h = -0.5U (from suspend to resume)
        // Total: 0U
        const tempBoluses = treatments.filter(t => t.insulin !== undefined);
        const totalInsulin = tempBoluses.reduce((sum, bolus) => sum + bolus.insulin, 0);
        totalInsulin.should.be.approximately(0.0, 0.05);
    });
});
