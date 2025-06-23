'use strict';

require('should');
var _ = require('lodash');
var basal = require('../lib/profile/basal');

describe('Basal Profile', function() {

    // Note: Omit the `i` property to match what the Swift implementation produces
    var basalprofile = [
        { minutes: 0, rate: 2, start: '00:00:00' },
        { minutes: 180, rate: 3, start: '03:00:00' },
        { minutes: 360, rate: 1.5, start: '06:00:00' }
    ];

    it('should return current basal rate from schedule', function() {
        var now = new Date('2025-01-26T02:00:00');
        var rate = basal.basalLookup(basalprofile, now);
        rate.should.equal(2);
    });

    it('should handle rate schedule changes', function() {
        var now = new Date('2025-01-26T04:00:00');
        var rate = basal.basalLookup(basalprofile, now);
        rate.should.equal(3);
    });

    it('should calculate max daily basal correctly', function() {
        var max = basal.maxDailyBasal({ basals: basalprofile });
        max.should.equal(3);
    });

    it('should handle invalid basal profiles', function() {
        var invalid_profile = [{ minutes: 0, rate: 0, start: '00:00:00' }];
        var rate = basal.basalLookup(invalid_profile);
        should.not.exist(rate);
    });
});
