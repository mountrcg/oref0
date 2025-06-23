'use strict';

var should = require('should');
var _ = require('lodash');
var isf = require('../lib/profile/isf');

describe('ISF Profile', function() {
    var isf_data = {
        sensitivities: [
            { offset: 0, sensitivity: 100, start: '00:00:00' },
            { offset: 180, sensitivity: 80, start: '03:00:00' },
            { offset: 360, sensitivity: 90, start: '06:00:00' }
        ]
    };

    it('should return current insulin sensitivity factor from schedule', function() {
        var now = new Date('2025-01-26T02:00:00');
        var sensitivity = isf.isfLookup(isf_data, now);
        sensitivity.should.equal(100);
    });

    it('should handle sensitivity schedule changes', function() {
        var now = new Date('2025-01-26T04:00:00');
        var sensitivity = isf.isfLookup(isf_data, now);
        sensitivity.should.equal(80);
    });

    it('should use last sensitivity if past schedule end', function() {
        var now = new Date('2025-01-26T23:00:00');
        var sensitivity = isf.isfLookup(isf_data, now);
        sensitivity.should.equal(90);
    });

    // Tests caching behavior
    it('should cache last result', function() {
        var now = new Date('2025-01-26T04:30:00');
        var sensitivity1 = isf.isfLookup(isf_data, now);
        var sensitivity2 = isf.isfLookup(isf_data, now);
        sensitivity1.should.equal(sensitivity2);
        sensitivity1.should.equal(80);
    });

    it('should return -1 for invalid profile with non-zero first offset', function() {
        var invalid_isf = {
            sensitivities: [
                { offset: 30, sensitivity: 100, start: '00:30:00' }
            ]
        };
        var sensitivity = isf.isfLookup(invalid_isf);
        sensitivity.should.equal(-1);
    });
});
