
function getTime(minutes, testTime) {
    var baseTime = new Date();
    if (typeof(testTime) !== 'undefined') {
        baseTime = new Date(testTime);
    }

    baseTime.setHours('00');
    baseTime.setMinutes('00');
    baseTime.setSeconds('00');    
    
    return baseTime.getTime() + minutes * 60 * 1000;
}

exports = module.exports = getTime;

