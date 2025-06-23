'use strict';

require('should');
const moment = require('moment');
const iobCalc = require('../lib/iob/calculate');

describe('Calculate IOB', function() {
    // Helper function to create a basic treatment
    function createTreatment(insulin, date) {
        return {
            insulin: insulin,
            date: date
        };
    }

    // Helper function to create a basic profile
    function createProfile(curve = 'rapid-acting', useCustomPeakTime = false, insulinPeakTime = undefined) {
        return {
            curve: curve,
            useCustomPeakTime: useCustomPeakTime,
            insulinPeakTime: insulinPeakTime
        };
    }

    it('should return empty object when treatment has no insulin', function() {
        const treatment = { date: new Date() };
        const result = iobCalc(treatment, new Date(), 'exponential', 3, 75, createProfile());
        result.should.be.an.Object();
        Object.keys(result).length.should.equal(0);
    });

    it('should calculate IOB with default rapid-acting settings', function() {
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
        const treatment = createTreatment(2.0, thirtyMinsAgo);
        
        const result = iobCalc(treatment, now, 'rapid-acting', 3, 75, createProfile());
        
        result.should.have.properties('activityContrib', 'iobContrib');
        result.activityContrib.should.be.approximately(0.0115, 0.0001);
        result.iobContrib.should.be.approximately(1.8085, 0.0001);
    });

    it('should calculate IOB with custom peak time for rapid-acting insulin', function() {
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
        const treatment = createTreatment(2.0, thirtyMinsAgo);
        const profile = createProfile('rapid-acting', true, 100);
        
        const result = iobCalc(treatment, now, 'rapid-acting', 3, 100, profile);
        
        result.should.have.properties('activityContrib', 'iobContrib');
        result.activityContrib.should.be.approximately(0.0079, 0.0001);
        result.iobContrib.should.be.approximately(1.8763, 0.0001);
    });

    it('should handle peak time limits for rapid-acting insulin', function() {
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
        const treatment = createTreatment(2.0, thirtyMinsAgo);
        
        // Test upper limit (120)
        const profileHigh = createProfile('rapid-acting', true, 150);
        const resultHigh = iobCalc(treatment, now, 'rapid-acting', 3, 120, profileHigh);
        resultHigh.should.have.properties('activityContrib', 'iobContrib');
        
        // Test lower limit (50)
        const profileLow = createProfile('rapid-acting', true, 30);
        const resultLow = iobCalc(treatment, now, 'rapid-acting', 3, 50, profileLow);
        resultLow.should.have.properties('activityContrib', 'iobContrib');
    });

    it('should calculate IOB with ultra-rapid insulin', function() {
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
        const treatment = createTreatment(2.0, thirtyMinsAgo);
        const profile = createProfile('ultra-rapid');
        
        const result = iobCalc(treatment, now, 'ultra-rapid', 3, 55, profile);
        
        result.should.have.properties('activityContrib', 'iobContrib');
        result.activityContrib.should.be.approximately(0.01569, 0.0001);
        result.iobContrib.should.be.approximately(1.7202, 0.0001);
    });

    it('should handle peak time limits for ultra-rapid insulin', function() {
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
        const treatment = createTreatment(2.0, thirtyMinsAgo);
        
        // Test upper limit (100)
        const profileHigh = createProfile('ultra-rapid', true, 120);
        const resultHigh = iobCalc(treatment, now, 'ultra-rapid', 3, 100, profileHigh);
        resultHigh.should.have.properties('activityContrib', 'iobContrib');
        
        // Test lower limit (35)
        const profileLow = createProfile('ultra-rapid', true, 30);
        const resultLow = iobCalc(treatment, now, 'ultra-rapid', 3, 35, profileLow);
        resultLow.should.have.properties('activityContrib', 'iobContrib');
    });

    it('should handle insulin activity after DIA', function() {
        const now = new Date();
        const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
        const treatment = createTreatment(2.0, fourHoursAgo);
        
        const result = iobCalc(treatment, now, 'rapid-acting', 3, 75, createProfile());
        
        result.should.have.properties('activityContrib', 'iobContrib');
        result.activityContrib.should.equal(0);
        result.iobContrib.should.equal(0);
    });
});
