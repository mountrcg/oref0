'use strict';

const { find } = require('lodash');
var should = require('should');
const { LoaderTargetPlugin } = require('webpack');

describe('meal-generate', function ( ) {
    const fs = require('fs');
    const path = require('path');
    
    var generate = require('../lib/meal/index');
    const filePath = path.join(__dirname, 'meal-input.json');
    const rawData = fs.readFileSync(filePath, 'utf8');
    const inputs = JSON.parse(rawData);

    const glucose = JSON.parse(inputs.glucose);
    const profile = JSON.parse(inputs.profile);
    const basalProfile = JSON.parse(inputs.basalProfile);
    const pumpHistory = JSON.parse(inputs.pumpHistory);
    const clock = JSON.parse(inputs.clock);
    const carbs = JSON.parse(inputs.carbs);
    const loggedMeal = JSON.parse(inputs.meal);

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
    console.log(loggedMeal);
});

describe('meal/history', function() {
    var find_meal_inputs = require('../lib/meal/history');
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, 'meal-input.json');
    const rawData = fs.readFileSync(filePath, 'utf8');
    const inputs = JSON.parse(rawData);

    const glucose = JSON.parse(inputs.glucose);
    const profile = JSON.parse(inputs.profile);
    const basalProfile = JSON.parse(inputs.basalProfile);
    const pumpHistory = JSON.parse(inputs.pumpHistory);
    const clock = JSON.parse(inputs.clock);
    const carbs = JSON.parse(inputs.carbs);

    var mealInputs = {
        history: pumpHistory
      , profile: profile
      , basalprofile: basalProfile
      , clock: clock
      , carbs: carbs
      , glucose: glucose
    };

    var result = find_meal_inputs(mealInputs);
    console.log(result);

});

describe('meal/total', function() {
    var tz = require('moment-timezone');
    var sum = require('../lib/meal/total');
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, 'meal-input.json');
    const rawData = fs.readFileSync(filePath, 'utf8');
    const inputs = JSON.parse(rawData);

    const glucose = JSON.parse(inputs.glucose);
    const profile = JSON.parse(inputs.profile);
    const basalProfile = JSON.parse(inputs.basalProfile);
    const pumpHistory = JSON.parse(inputs.pumpHistory);
    const clock = JSON.parse(inputs.clock);

    const treatments = [
        { timestamp: '2025-03-28T14:22:16.631Z', carbs: 50, nsCarbs: 50 },
        { timestamp: '2025-03-28T14:22:33.030Z', bolus: 4.4 }
    ];

    var opts = {
        treatments: treatments
      , profile: profile
      , pumphistory: pumpHistory
      , glucose: glucose
      , basalprofile: basalProfile
    };
    
    var clockInput = new Date(tz(clock));

    var result = sum(opts, clockInput);
    console.log(result);
});