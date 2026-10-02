const path = require('node:path');

process.env.electron_config_cache = path.join(__dirname, '..', '.electron-cache');
require('../node_modules/electron/install.js');
