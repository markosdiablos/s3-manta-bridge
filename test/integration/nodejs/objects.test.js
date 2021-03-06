'use strict';

let mod_fs = require('fs');
let mod_request = require('sync-request');
let mod_util = require('util');
let mod_vasync = require('vasync');
let mod_stream = require('stream');
let mod_lo = require('lodash');
let mod_url = require('url');

///--- Globals
let helper = require('./helper');

/** @type {MantaClient} */
let manta = helper.mantaClient;
let s3 = helper.s3Client;
let test = helper.test;

/////--- Tests

test('server is alive', function (t) {
    t.plan(1);
    let host = `http://localhost:${helper.config.serverPort}`;
    let res = mod_request('HEAD', host);

    t.equal(res.statusCode, 405, `Expecting server to be reachable at ${host}`);
    t.end();
});

test('test bucket subdomain is active', function(t) {
    let bucket = 'predictable-bucket-name';

    let port = helper.config.serverPort;
    let host = `http://${bucket}.${helper.config.baseHostname}:${port}`;
    t.ok(mod_url.parse(host), `A valid host was constructed: ${host}`);
    let res = mod_request('HEAD', host);

    /* A 404 means that we connected and it is the right status code
     * because there is no bucket at that location currently. */
    t.equal(res.statusCode, 404, `Expecting server to be reachable at ${host}`);
    t.end();
});

function verifyObjectUpload(object, expected, t, next) {
    let bucket = 'predictable-bucket-name';
    let mantaDir = `${helper.config.bucketPath}/${bucket}`;
    let mantaPath = `${mantaDir}/${expected}`;
    let filepath = `${__dirname}/../../data/sample.txt`;

    mod_fs.readFile(filepath, function (err, data) {
        t.ifError(err, `${filepath} read without problems`);
        s3.createBucket({ Bucket: bucket}, function createS3Bucket(err) {
            t.ifError(err, `No error when creating [${bucket}] bucket`);

            let params = {
                Bucket: bucket,
                Key: object,
                Body: data
            };

            s3.putObject(params, function putObjectS3(err) {
                if (err) {
                    t.fail(err.message);
                }

                manta.info(mantaPath, function(mantaInfoError, info) {
                    t.ifError(mantaInfoError, `Object [${expected}] should be available`);

                    t.equals(info.name, expected,
                        `Uploaded name and actual name are identical [${info.name}=${expected}]`);

                    next(t);
                });
            });
        });
    });
}

test('can add an object [sample.txt]', function(t) {
    let object = 'sample.txt';

    verifyObjectUpload(object, object, t, function(t) {
        t.end();
    });
});

test('can add an object [server-enterprise_4.0.0-dp-macos_x86_64.zip]', function(t) {
    let object = 'server-enterprise_4.0.0-dp-macos_x86_64.zip';

    verifyObjectUpload(object, object, t, function(t) {
        t.end();
    });
});

test('can add an object [filename with spaces.txt]', function(t) {
    let object = 'filename with spaces.txt';

    verifyObjectUpload(object, object, t, function(t) {
        t.end();
    });
});

test('can add an object [ユニコード文字テスト.txt]', function(t) {
    let object = 'ユニコード文字テスト.txt';

    verifyObjectUpload(object, object, t, function(t) {
        t.end();
    });
});

test('relative paths are stripped [../bad_filename.txt]', function(t) {
    let object = '../bad_filename.txt';
    let expected = 'bad_filename.txt';

    verifyObjectUpload(object, expected, t, function(t) {
        t.end();
    });
});

test('can get an object', function(t) {
    let bucket = 'predictable-bucket-name';
    let object = 'sample.txt';
    let filepath = `${__dirname}/../../data/${object}`;
    let mantaDir = `${helper.config.bucketPath}/${bucket}`;
    let mantaPath = `${mantaDir}/${object}`;

    let fileStream = mod_fs.createReadStream(filepath, { autoClose: true });
    let contents = mod_fs.readFileSync(filepath, 'utf8');

    t.plan(4);

    manta.put(mantaPath, fileStream, { mkdirs: true }, function putTestObj(err) {
        t.ifError(err, `Added ${mantaPath} without problems`);

        let params = {
            Bucket: bucket,
            Key: object
        };

        s3.getObject(params, function getObj(err, data) {
            t.ifError(err, `Got object ${mantaPath} via the S3 API with errors`);

            t.ok(data, 'S3 response present');
            let actualContents = data.Body.toString();
            t.equal(actualContents, contents, 'File contents are as expected');

            t.end();
        });
    });
});

test('can add and get an object with metadata', function(t) {
    let bucket = 'predictable-bucket-name';
    let object = 'sample.txt';
    let filepath = `${__dirname}/../../data/${object}`;

    mod_fs.readFile(filepath, function (err, data) {
        t.ifError(err, `${filepath} read without problems`);
        s3.createBucket({ Bucket: bucket}, function(err) {
            t.ifError(err, `No error when creating [${bucket}] bucket`);

            let params = {
                Bucket: bucket,
                Key: object,
                Body: data,
                Metadata: {
                    foo: 'bar',
                    animal: 'cat'
                }
            };

            s3.putObject(params, function(err) {
                if (err) {
                    t.fail(err.message);
                }

                s3.getObject({ Bucket: bucket, Key: object }, function getObj(err, data) {
                    t.ifError(err, `Got object ${object} via the S3 API with errors`);

                    t.ok(data, 'S3 response present');
                    t.ok(mod_lo.hasIn(data, 'Metadata'), 'Metadata is associated with object');
                    let actualMetadata = data.Metadata;
                    t.deepEqual(actualMetadata, params.Metadata, 'Metadata is as expected');

                    t.end();
                });
            });
        });
    });
});

test('can add and get an object with reduced redundancy', function(t) {
    let bucket = 'predictable-bucket-name';
    let object = 'sample.txt';
    let filepath = `${__dirname}/../../data/${object}`;

    mod_fs.readFile(filepath, function (err, data) {
        t.ifError(err, `${filepath} read without problems`);
        s3.createBucket({ Bucket: bucket}, function(err) {
            t.ifError(err, `No error when creating [${bucket}] bucket`);

            let params = {
                Bucket: bucket,
                Key: object,
                Body: data,
                StorageClass: 'REDUCED_REDUNDANCY'
            };

            s3.putObject(params, function(err) {
                if (err) {
                    t.fail(err.message);
                }

                s3.getObject({ Bucket: bucket, Key: object }, function getObj(err, data) {
                    t.ifError(err, `Got object ${object} via the S3 API with errors`);

                    t.ok(data, 'S3 response present');
                    let actual = data.StorageClass;
                    t.deepEqual(actual, params.StorageClass, 'Storage class is as expected');

                    t.end();
                });
            });
        });
    });
});

test('can add a directory', function(t) {
    let bucket = 'predictable-bucket-name';
    let directory = 'test-directory/';
    let mantaDir = `${helper.config.bucketPath}/${bucket}`;
    let mantaPath = `${mantaDir}/${directory}`;


    s3.createBucket({ Bucket: bucket}, function(createBucketErr) {
        t.ifError(createBucketErr, `No error when creating [${bucket}] bucket`);

        let params = {
            Bucket: bucket,
            Key: directory
        };

        s3.putObject(params, function(err) {
            if (err) {
                t.fail(err.message);
            }

            manta.info(mantaPath, function(mantaInfoError, info) {
                if (mantaInfoError) {
                    t.fail(mantaInfoError.message);
                }

                t.equals(info.name, mod_lo.trimEnd(directory, '/'));
                t.equals(info.type, 'application/x-json-stream; type=directory');
                t.end();
            });
        });
    });
});

test('can\'t get a directory as an object', function(t) {
    let bucket = 'predictable-bucket-name';
    let object = 'test-directory';
    let mantaPath = `${helper.config.bucketPath}/${bucket}/${object}`;

    manta.mkdirp(mantaPath, function(err) {
        t.ifError(err, `${mantaPath} directory created without a problem`);

        let params = {
            Bucket: bucket,
            Key: object
        };

        s3.getObject(params, function getObj(err) {
            t.equal(err.statusCode, 404, 'Expecting 404 from server for directory requested as object');
            t.end();
        });
    });
});

test('can delete a single object', function(t) {
    let bucket = 'predictable-bucket-name';
    let object = 'sample.txt';
    let filepath = `${__dirname}/../../data/${object}`;
    let mantaDir = `${helper.config.bucketPath}/${bucket}`;
    let mantaPath = `${mantaDir}/${object}`;

    let fileStream = mod_fs.createReadStream(filepath, { autoClose: true });

    t.plan(3);

    manta.put(mantaPath, fileStream, { mkdirs: true }, function (err) {
        t.ifError(err, `Added ${mantaPath} without problems`);

        let params = {
            Bucket: bucket,
            Key: object
        };

        s3.deleteObject(params, function (err, data) {
            t.ifError(err, `Deleted object ${mantaPath} via the S3 API without errors`);

            t.ok(data, 'S3 response present');
            t.end();
        });
    });
});

function noOfKeys(array, keyName, key) {
    let totalKeys = 0;

    for (let i = 0; i < array.length; i++) {
        if (array[i][keyName] && array[i][keyName] === key) {
            totalKeys++;
        }
    }

    return totalKeys;
}

test('can list a bucket for objects', function(t) {
    let bucket = 'predictable-bucket-name';
    let testData = 'Hello Manta!';

    let testContents = [
        mod_util.format('%s/%s/dir1', helper.config.bucketPath, bucket),
        mod_util.format('%s/%s/file1', helper.config.bucketPath, bucket),
        mod_util.format('%s/%s/dir1/file2', helper.config.bucketPath, bucket),
        mod_util.format('%s/%s/dir2', helper.config.bucketPath, bucket),
        mod_util.format('%s/%s/dir3', helper.config.bucketPath, bucket),
        mod_util.format('%s/%s/dir3/file3', helper.config.bucketPath, bucket),
        mod_util.format('%s/%s/dir3/file4', helper.config.bucketPath, bucket),
        mod_util.format('%s/%s/dir3/dir4/file5', helper.config.bucketPath, bucket),
        mod_util.format('%s/%s/file6', helper.config.bucketPath, bucket)
    ];

    let addTestData = function addTestData(path, cb) {
        if (path.match(/^.*dir[0-9]+[/]*$/)) {
            manta.mkdirp(path, cb);
        } else {
            let buff = new mod_stream.Readable();
            buff.push(testData);
            buff.push(null);

            manta.put(path, buff, { mkdirs: true }, cb);
        }
    };

    mod_vasync.forEachParallel({
        func: addTestData,
        inputs: testContents
    }, function(err, result) {
        t.ifError(err, 'All files added as expected');
        t.equal(result.ndone, 9, 'There should be nine paths created');

        let params = {
            Bucket: bucket
        };

        s3.listObjects(params, function(err, data) {
            t.ifError(err, 'No errors listing objects in bucket');

            t.equals(data.Delimiter, '/', 'Assume forward slash for delimiter ' +
                'because none specified');
            t.equal(data.Prefix, '', 'Assume empty prefix because none specified');
            t.equal(data.Marker, '', 'Assume empty marker because none specified');
            t.equal(data.MaxKeys, 1000, 'Assume 1000 keys by default');

            let files = data.Contents;
            let dirs = data.CommonPrefixes;

            t.equals(files.length, 2, 'there should be only two files displayed');
            t.equals(noOfKeys(files, 'Key', 'file1'), 1, 'there is only 1 file1');
            t.equals(noOfKeys(files, 'Key', 'file6'), 1, 'there is only 1 file6');

            t.equals(dirs.length, 3, 'there should be only three directories displayed');
            t.equals(noOfKeys(dirs, 'Prefix', 'dir1/'), 1, 'there is only 1 dir1');
            t.equals(noOfKeys(dirs, 'Prefix', 'dir2/'), 1, 'there is only 1 dir2');
            t.equals(noOfKeys(dirs, 'Prefix', 'dir3/'), 1, 'there is only 1 dir3');

            t.end();
        });
    });
});

test('can list multi-part uploads', function(t) {
    let bucket = 'predictable-bucket-name';
    let mantaDir = `${helper.config.bucketPath}/${bucket}`;

    t.plan(6);

    manta.mkdirp(mantaDir, function (err) {
        t.ifError(err, `Created ${mantaDir} without problems`);

        let params = {
            Bucket: bucket
        };

        s3.listMultipartUploads(params, function (err, data) {
            t.ifError(err, `Multipart response for bucket [${bucket}]returned without errors`);

            t.ok(data, 'S3 response present');
            t.equals(data.Bucket, bucket, `Bucket specified [${bucket}] was in result`);
            t.equals(data.IsTruncated, false);
            t.equals(data.MaxUploads, 1000);
            t.end();
        });
    });
});

test('can get the ACL for an object', function(t) {
    let bucket = 'predictable-bucket-name';
    let object = 'sample.txt';
    let filepath = `${__dirname}/../../data/${object}`;
    let mantaDir = `${helper.config.bucketPath}/${bucket}`;
    let mantaPath = `${mantaDir}/${object}`;

    let fileStream = mod_fs.createReadStream(filepath, { autoClose: true });

    t.plan(5);

    manta.put(mantaPath, fileStream, { mkdirs: true }, function (err) {
        t.ifError(err, `Added ${mantaPath} without problems`);

        let params = {
            Bucket: bucket,
            Key: object
        };

        s3.getObjectAcl(params, function (err, data) {
            t.ifError(err, `Acl returned for object ${mantaPath} via the S3 API without errors`);

            t.ok(data, 'S3 response present');
            t.ok(data.Owner, 'Owner present in response');
            t.ok(data.Grants, 'Grants present in response');

            t.end();
        });
    });
});

test('can copy an object between directories', function(t) {
    let bucket = 'predictable-bucket-name';
    let source = 'sample.txt';
    let destination = 'dir1/sample-copy.txt';
    let filepath = `${__dirname}/../../data/${source}`;
    let mantaDir = `${helper.config.bucketPath}/${bucket}`;
    let mantaPath = `${mantaDir}/${source}`;

    let fileStream = mod_fs.createReadStream(filepath, { autoClose: true });

    t.plan(4);

    manta.put(mantaPath, fileStream, { mkdirs: true }, function (err) {
        t.ifError(err, `Added ${mantaPath} without problems`);

        let params = {
            Bucket: bucket,
            CopySource: source,
            Key: destination
        };

        s3.copyObject(params, function (err, data) {
            t.ifError(err, `Object copied to ${destination} via the S3 API without errors`);

            t.ok(data, 'S3 response present');

            manta.info(`${mantaDir}/${destination}`, function dstCheck(lnErr) {
                t.ifError(lnErr, 'Object arrived as expected in destination');
                t.end();
            });
        });
    });
});
