#!/bin/bash

# Launch this script by typing /bin/bash webpack-cp.sh
#
# or with rexcutable permission: ./webpack-cp.sh
#
# modify permission by typing chmod a+x webpack-cp.sh
#
# perform webpack on the nine .js files:
#
# ./lib/iob/index.js
# ./lib/meal/index.js
# ./lib/determine-basal/determine-basal.js
# ./lib/glucose-get-last.js
# ./lib/basal-set-temp.js
# ./lib/determine-basal/autosens.js
# ./lib/profile/index.js
# ./lib/autotune-prep/index.js
# ./lib/autotune/index.js

npx webpack

#
#  --- Copy and rename oref0/dist .js files to FreeAPS/Resources/javascript/bundle ---
#
# change directory variables as needed:
oref0DIR=./
apsDIR=../Trio-dev


bundleDIR=$apsDIR/TrioTests/OpenAPSSwiftTests/javascript/bundle

cp -p -v $oref0DIR/dist/bundle/*.js $bundleDIR/

