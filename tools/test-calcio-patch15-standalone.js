'use strict';
const path = require('path');
const { run } = require('./calcioPatch15VerificationCore');
(async () => {
    const root = path.resolve(process.argv[2] || '.');
    const result = await run(root);
    console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error.stack || error); process.exit(1); });
