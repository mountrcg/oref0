'use strict';

var should = require('should');

describe('meal-generate', function ( ) {
    const fs = require('fs');
    const path = require('path');
    
    var generate = require('../lib/meal/index');
    const filePath = path.join(__dirname, 'meal_error_inputs.json');
    const rawData = fs.readFileSync(filePath, 'utf8');
    const inputs = JSON.parse(rawData);

    const glucose = inputs.glucose;
    const profile = inputs.profile;
    const basalProfile = inputs.basalProfile;
    const pumpHistory = inputs.pumpHistory;
    const clock = inputs.clock;
    const carbs = inputs.carbs;

    var mealInputs = {
        history: pumpHistory
      , profile: profile
      , basalprofile: basalProfile
      , clock: clock
      , carbs: carbs
      , glucose: glucose
    };

    // Invoke determine_basal with all parameters
    const result = generate(mealInputs);

    // Do something with the result
    console.log(result);
});


