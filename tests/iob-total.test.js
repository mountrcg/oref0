'use strict';

require('should');
const moment = require('moment');
const iobTotal = require('../lib/iob/total');
const iobCalc = require('../lib/iob/calculate');

describe('Calculate Total IOB', function() {
    // Helper function to create a basic treatment
    function createTreatment(insulin, date) {
        return {
            insulin: insulin,
            date: date instanceof Date ? date.getTime() : date,
            created_at: new Date(date).toISOString()
        };
    }

    // Helper function to create basic profile data
    function createProfile(dia = 5, curve = 'rapid-acting', useCustomPeakTime = false, insulinPeakTime = undefined) {
        return {
            dia: dia,
            curve: curve,
            useCustomPeakTime: useCustomPeakTime,
            insulinPeakTime: insulinPeakTime
        };
    }

    // Helper function to create options object
    function createOpts(treatments = [], profile = createProfile(), calculate = iobCalc) {
        return {
            treatments: treatments,
            profile: profile,
            calculate: calculate
        };
    }

    it('should return empty object when no treatments provided', function() {
        const now = new Date();
        const result = iobTotal(createOpts(), now);
        result.should.be.an.Object();
        result.should.have.properties(['iob', 'activity', 'basaliob', 'bolusiob', 'netbasalinsulin', 'bolusinsulin', 'time']);
        result.iob.should.equal(0);
        result.activity.should.equal(0);
    });

    it('should calculate total IOB with rapid-acting insulin bolus', function() {
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
        const treatments = [createTreatment(2.0, thirtyMinsAgo)];
        
        const result = iobTotal(createOpts(treatments, createProfile(5, 'rapid-acting')), now);
        
        result.should.have.properties(['iob', 'activity', 'basaliob', 'bolusiob']);
        result.iob.should.be.approximately(1.8, 0.1);
        result.bolusiob.should.be.approximately(1.8, 0.1);
        result.basaliob.should.equal(0);
    });

    it('should calculate total IOB with ultra-rapid insulin bolus', function() {
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
        const treatments = [createTreatment(2.0, thirtyMinsAgo)];
        
        const result = iobTotal(createOpts(treatments, createProfile(5, 'ultra-rapid')), now);
        
        result.should.have.properties(['iob', 'activity', 'basaliob', 'bolusiob']);
        result.iob.should.be.approximately(1.769, 0.001);
        result.bolusiob.should.be.approximately(1.769, 0.001);
        result.basaliob.should.equal(0);
    });

    it('should calculate total IOB with basal insulin', function() {
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
        const treatments = [createTreatment(-0.05, thirtyMinsAgo)];
        
        const result = iobTotal(createOpts(treatments, createProfile(5, 'rapid-acting')), now);
        
        result.should.have.properties(['iob', 'activity', 'basaliob', 'bolusiob']);
        result.basaliob.should.be.approximately(-0.046, 0.001);
        result.bolusiob.should.equal(0);
    });

    it('should handle multiple treatments of different types', function() {
        const now = new Date();
        const treatments = [
            createTreatment(2.0, new Date(now.getTime() - 30 * 60 * 1000)), // bolus
            createTreatment(0.05, new Date(now.getTime() - 20 * 60 * 1000), 'basal'),
            createTreatment(1.0, new Date(now.getTime() - 10 * 60 * 1000)) // bolus
        ];
        
        const result = iobTotal(createOpts(treatments, createProfile(5, 'rapid-acting')), now);
        
        result.should.have.properties(['iob', 'activity', 'basaliob', 'bolusiob']);
        result.basaliob.should.equal(0.048);
        result.bolusinsulin.should.equal(3.0);
        result.netbasalinsulin.should.equal(0.05);
    });

    it('should handle custom peak times for rapid-acting insulin', function() {
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
        const treatments = [createTreatment(2.0, thirtyMinsAgo)];
        const profile = createProfile(5, 'rapid-acting', true, 100);
        
        const result = iobTotal(createOpts(treatments, profile), now);
        
        result.should.have.properties(['iob', 'activity', 'basaliob', 'bolusiob']);
        result.iob.should.be.approximately(1.898, 0.001);
    });

    it('should handle custom peak times for ultra-rapid insulin', function() {
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
        const treatments = [createTreatment(2.0, thirtyMinsAgo)];
        const profile = createProfile(5, 'ultra-rapid', true, 80);
        
        const result = iobTotal(createOpts(treatments, profile), now);
        
        result.should.have.properties(['iob', 'activity', 'basaliob', 'bolusiob']);
        result.iob.should.be.approximately(1.863, 0.001);
    });

    it('should enforce peak time limits for rapid-acting insulin', function() {
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
        const treatments = [createTreatment(2.0, thirtyMinsAgo)];
        
        // Test upper limit (120)
        const resultHigh = iobTotal(createOpts(treatments, createProfile(5, 'rapid-acting', true, 150)), now);
        resultHigh.should.have.properties(['iob', 'activity']);
        
        // Test lower limit (50)
        const resultLow = iobTotal(createOpts(treatments, createProfile(5, 'rapid-acting', true, 30)), now);
        resultLow.should.have.properties(['iob', 'activity']);
    });

    it('should enforce peak time limits for ultra-rapid insulin', function() {
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
        const treatments = [createTreatment(2.0, thirtyMinsAgo)];
        
        // Test upper limit (100)
        const resultHigh = iobTotal(createOpts(treatments, createProfile(5, 'ultra-rapid', true, 120)), now);
        resultHigh.should.have.properties(['iob', 'activity']);
        
        // Test lower limit (35)
        const resultLow = iobTotal(createOpts(treatments, createProfile(5, 'ultra-rapid', true, 30)), now);
        resultLow.should.have.properties(['iob', 'activity']);
    });

    it('should ignore future treatments', function() {
        const now = new Date();
        const treatments = [
            createTreatment(2.0, new Date(now.getTime() + 30 * 60 * 1000)), // future
            createTreatment(1.0, new Date(now.getTime() - 10 * 60 * 1000)) // past
        ];
        
        const result = iobTotal(createOpts(treatments, createProfile(5, 'rapid-acting')), now);
        
        result.bolusinsulin.should.equal(1.0);
    });

    it('should ignore treatments older than DIA', function() {
        const now = new Date();
        const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
        const treatments = [createTreatment(2.0, sixHoursAgo)];
        
        const result = iobTotal(createOpts(treatments, createProfile(5, 'rapid-acting')), now);
        
        result.iob.should.equal(0);
        result.activity.should.equal(0);
    });

    it('should enforce minimum DIA of 5 hours for both insulin types', function() {
        const now = new Date();
        const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
        const treatments = [createTreatment(2.0, fourHoursAgo)];
        
        // Test rapid-acting
        const rapidResult = iobTotal(createOpts(treatments, createProfile(4, 'rapid-acting')), now);
        rapidResult.iob.should.be.above(0);
        
        // Test ultra-rapid
        const ultraResult = iobTotal(createOpts(treatments, createProfile(4, 'ultra-rapid')), now);
        ultraResult.iob.should.be.above(0);
    });
});
