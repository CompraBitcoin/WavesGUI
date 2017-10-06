import * as gulp from 'gulp';
import * as concat from 'gulp-concat';
import * as babel from 'gulp-babel';
import * as copy from 'gulp-copy';
import { exec, execSync } from 'child_process';
import { getFilesFrom, prepareHTML, run, task } from './ts-scripts/utils';
import { join } from 'path';
import { copy as fsCopy, outputFile, readFile, readJSON, readJSONSync } from 'fs-extra';
import { IMetaJSON, IPackageJSON } from './ts-scripts/interface';

const zip = require('gulp-zip');
const s3 = require('gulp-s3');

const meta: IMetaJSON = readJSONSync('ts-scripts/meta.json');
const pack: IPackageJSON = readJSONSync('package.json');
const configurations = Object.keys(meta.configurations);
const AWS = {
    key: process.env.AWS_ACCESS_KEY_ID,
    secret: process.env.AWS_SECRET_ACCESS_KEY,
    region: 'eu-central-1'
};

const sourceFiles = getFilesFrom('./src', '.js', function (name, path) {
    return !name.includes('.spec') && !path.includes('/test/');
});

const taskHash = {
    concat: [],
    html: [],
    copy: [],
    zip: []
};

const tmpJsPath = './dist/tmp/js';
const tmpCssPath = './dist/tmp/css';
const vendorName = 'vendors.js';
const bundleName = 'bundle.js';
const cssName = `${pack.name}-styles-${pack.version}.css`;
const vendorPath = join(tmpJsPath, vendorName);
const bundlePath = join(tmpJsPath, bundleName);
const cssPath = join(tmpCssPath, cssName);


const getFileName = (name, type) => {
    const postfix = type === 'min' ? '.min' : '';
    return `${name.replace('.js', '')}${postfix}.js`;
};


const indexPromise = readFile('src/index.html', { encoding: 'utf8' });

['build', 'chrome', 'desktop'].forEach((buildName) => {

    configurations.forEach((configName) => {

        const config = meta.configurations[configName];

        ['dev', 'normal', 'min'].forEach((type) => {

            const targetPath = `./dist/${buildName}/${configName}/${type}`;
            const jsFileName = getName(`${pack.name}-${buildName}-${configName}-${pack.version}.js`);
            const jsFilePath = join(targetPath, 'js', jsFileName);
            const taskPostfix = `${buildName}-${configName}-${type}`;


            if (type !== 'dev') {
                task(`concat-${taskPostfix}`, [type === 'min' ? 'uglify' : 'babel'], function (done) {
                    const stream = gulp.src([vendorPath, getName(bundlePath)])
                        .pipe(concat(jsFileName))
                        .pipe(gulp.dest(`${targetPath}/js`));

                    stream.on('end', function () {
                        readFile(`${targetPath}/js/${jsFileName}`, { encoding: 'utf8' }).then((file) => {
                            outputFile(`${targetPath}/js/${jsFileName}`, file)
                                .then(() => done());
                        });
                    });
                });
                taskHash.concat.push(`concat-${taskPostfix}`);
            }

            task(`copy-${taskPostfix}`, ['concat-style'], function (done) {
                let forCopy = [];

                if (buildName === 'chrome') {
                    forCopy = [
                        fsCopy('./src/chrome', targetPath)
                    ];
                } else if (buildName === 'desktop') {
                    forCopy = [
                        fsCopy('src/desktop', targetPath)
                    ];
                } else if (type === 'dev') {
                    forCopy = []
                } else {
                    forCopy = [];
                }

                Promise.all([
                    fsCopy(cssPath, `${targetPath}/css/${pack.name}-styles-${pack.version}.css`),
                    fsCopy('LICENSE', `${targetPath}/LICENSE`),
                    fsCopy('3RD-PARTY-LICENSES.txt', `${targetPath}/3RD-PARTY-LICENSES.txt`),
                ].concat(forCopy)).then(() => {
                    done();
                }, (e) => {
                    console.log(e.message);
                });
            });
            taskHash.copy.push(`copy-${taskPostfix}`);


            const htmlDeps = type === 'dev' ? [] : [`concat-${taskPostfix}`];

            task(`html-${taskPostfix}`, htmlDeps.concat([`copy-${taskPostfix}`]), function (done) {
                indexPromise.then((file) => {
                    return prepareHTML({
                        target: targetPath,
                        connection: configName,
                        scripts: type === 'dev' ? meta.vendors.concat(sourceFiles) : [jsFilePath],
                        styles: [`${targetPath}/css/${pack.name}-styles-${pack.version}.css`]
                    })
                }).then((file) => {
                    console.log('out ' + configName);
                    outputFile(`${targetPath}/index.html`, file).then(() => done());
                });
            });
            taskHash.html.push(`html-${taskPostfix}`);

            function getName(name) {
                return getFileName(name, type);
            }

        });

    });

    task(`zip-${buildName}`, [
        `concat-${buildName}-mainnet-min`,
        `html-${buildName}-mainnet-min`,
        `copy-${buildName}-mainnet-min`
    ], function () {
        return gulp.src(`dist/${buildName}/mainnet/min/**/*.*`)
            .pipe(zip(`${pack.name}-${buildName}-v${pack.version}.zip`))
            .pipe(gulp.dest('dist'));
    });
    taskHash.zip.push(`zip-${buildName}`);

});

task('up-version-json', function (done) {
    console.log('new version: ', pack.version);

    const promises = [
        './src/desktop/package.json'
    ].map((path) => {
        return readJSON(path).then((json) => {
            json.version = pack.version;
            return outputFile(path, JSON.stringify(json, null, 2));
        });
    });

    Promise.all(promises)
        .then(() => {
            return run('git', ['add', '.']);
        })
        .then(() => {
            return run('git', ['commit', '-m', `Message: "${pack.version}" for other json files`]);
        })
        .then(() => {
            done();
        });
});

// task('templates', function () {
//     return gulp.src('src/templates/**/*.html')
//         .pipe(htmlmin({ collapseWhitespace: true }))
//         .pipe(templateCache({
//             module: 'app',
//             transformUrl: function (url) {
//                 return url.replace('.html', '');
//             }
//         }))
//         .pipe(gulp.dest(tmpJsPath));
// });

task('concat-style', ['less'], function () {
    return gulp.src(meta.stylesheets.concat(join(tmpCssPath, 'style.css')))
        .pipe(concat(cssName))
        .pipe(gulp.dest(tmpCssPath))
});

task('concat-develop-sources', function () {
    return gulp.src(sourceFiles)
        .pipe(concat(bundleName))
        .pipe(gulp.dest(tmpJsPath));
});

task('concat-develop-vendors', function () {
    return gulp.src(meta.vendors)
        .pipe(concat(vendorName))
        .pipe(gulp.dest(tmpJsPath));
});

task('clean', function (done) {
    run('sh', ['scripts/clean.sh']).then(() => done());
});

task('eslint', function (done) {
    run('sh', ['scripts/eslint.sh']).then(() => done());
});

task('less', function (done) {
    Promise.all([
        run('sh', ['scripts/less.sh']),
    ]).then(() => {
        getFilesFrom('./src', '.less').forEach((path) => {
            console.log(`Compile less file ${path}`);
            execSync(`node_modules/.bin/lessc ${path} ${path.replace('.less', '.css')}`);
        });
        done()
    });
});

task('babel', ['concat-develop'], function () {
    return gulp.src(bundlePath)
        .pipe(babel({
            presets: ['es2015'],
            plugins: [
                'transform-decorators-legacy',
                'transform-class-properties',
                'transform-decorators',
                'transform-object-rest-spread'
            ]
        }))
        .pipe(gulp.dest(tmpJsPath));
});

task('uglify', ['babel'], function (done) {
    //node_modules/.bin/uglifyjs ./dist/ts-utils.js -o ./dist/ts-utils.min.js
    exec(`./node_modules/.bin/uglifyjs ${bundlePath} -o ./dist/tmp/js/${getFileName(bundleName, 'min')}`, (err, l1, l2) => {
        if (err) {
            console.log(err);
        }

        done();
    });
});

task('s3-testnet', function () {
    const bucket = 'testnet.waveswallet.io';
    return gulp.src('./dist/testnet/**/*')
        .pipe(s3({ ...AWS, bucket }));
});

task('s3-mainnet', function () {
    const bucket = 'waveswallet.io';
    return gulp.src('./dist/mainnet/**/*')
        .pipe(s3({ ...AWS, bucket }));
});

task('s3', ['s3-testnet', 's3-mainnet']);

task('zip', configurations.map(name => `zip-${name}`));

task('concat-develop', [
    'concat-develop-sources',
    'concat-develop-vendors'
]);

task('build-main', getTasksFrom('build', taskHash.concat, taskHash.copy, taskHash.html));

task('concat', taskHash.concat.concat('concat-develop'));
task('copy', taskHash.copy);
task('html', taskHash.html);
task('zip', taskHash.zip);

task('all', [
    'clean',
    'concat',
    'copy',
    'html',
    'zip'
]);

function filterTask(forFind: string) {
    return (item) => {
        return item.includes(forFind);
    }
}

function getTasksFrom(filter: string, ...tasks: Array<Array<string>>): Array<string> {
    const processor = filterTask(filter);
    return tasks.reduce((result, taskList) => {
        result = result.concat(taskList.filter(processor));
        return result;
    }, []);
}
