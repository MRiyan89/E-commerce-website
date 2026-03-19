const fs = require('fs');
const path = require('path');
const decomment = require('decomment');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(function(file) {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory() && !file.includes('node_modules')) {
            results = results.concat(walk(file));
        } else {
            if (file.endsWith('.js')) {
                results.push(file);
            }
        }
    });
    return results;
}

const jsFiles = walk('./backend');
jsFiles.forEach(file => {
    try {
        const code = fs.readFileSync(file, 'utf8');
        const stripped = decomment(code);
        fs.writeFileSync(file, stripped);
        console.log(`Stripped JS: ${file}`);
    } catch(e) {
        console.error(`Error in ${file}:`, e.message);
    }
});

const sqlFiles = ['./schema.sql', './seed.sql'];
sqlFiles.forEach(file => {
   if (fs.existsSync(file)) {
       let sql = fs.readFileSync(file, 'utf8');
       sql = sql.replace(/\/\*[\s\S]*?\*\//g, '');
       sql = sql.replace(/--.*$/gm, '');
       sql = sql.replace(/^\s*[\r\n]/gm, '');
       fs.writeFileSync(file, sql);
       console.log(`Stripped SQL: ${file}`);
   } 
});
