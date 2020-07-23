'use strict'
const express = require('express')
const app = express()
const path = require('path')
const bodyParser = require('body-parser')
var cors = require('cors')
require('dotenv').config()
var aws = require('aws-sdk')
app.use(cors({ origin: '*' }))
app.use(bodyParser.json())
const ms = require('ms')
const secretManager = require('./secretManager')

aws.config.update({
    accessKeyId: secretManager.SecretsManager('AWS_ACESS_KEY_ID'),
    secretAccessKey: secretManager.SecretsManager('AWS_SECRET_ACCESS_KEY'),
    signatureVersion: 'v4',
    region: secretManager.SecretsManager('AWS_REGION')
})
var s3 = new aws.S3()
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept")
    next()
})
app.use(express.static('public'))
app.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'public', 'index.html'))
})
app.get('/s3upload', (req, res) => {
    res.send('hello from root')
})

/**
     * Get upload paramaters for a simple direct upload.
     *
     * Expected query parameters:
     *  - filename - The name of the file, given to the `config.getKey`
     *    option to determine the object key name in the S3 bucket.
     *  - type - The MIME type of the file.
     *
     * Response JSON:
     *  - method - The HTTP method to use to upload.
     *  - url - The URL to upload to.
     *  - fields - Form fields to send along.
     */
function getUploadParameters(req, res, next) {
    // @ts-ignore The `uppy` property is added by middleware before reaching here.

    const key = req.query.filename
    // if (typeof key !== 'string') {
    //     return res.status(500).json({ error: 's3: filename returned from `getKey` must be a string' })
    // }

    const fields = {
        //acl: config.acl,
        key: key,
        success_action_status: '201',
        'content-type': req.query.type
    }

    s3.createPresignedPost({
        Bucket: process.env.AWS_S3_BUCKET,
        Expires: ms('5 minutes') / 1000,
        Fields: fields,
        Conditions: config.conditions
    }, (err, data) => {
        if (err) {
            next(err)
            return
        }
        res.json({
            method: 'post',
            url: data.url,
            fields: data.fields
        })
    })
}
/**
 * Create an S3 multipart upload. With this, files can be uploaded in chunks of 5MB+ each.
 *
 * Expected JSON body:
 *  - filename - The name of the file, given to the `config.getKey`
 *    option to determine the object key name in the S3 bucket.
 *  - type - The MIME type of the file.
 *
 * Response JSON:
 *  - key - The object key in the S3 bucket.
 *  - uploadId - The ID of this multipart upload, to be used in later requests.
 */
function createMultipartUpload(req, res, next) {
    // @ts-ignore The `uppy` property is added by middleware before reaching here.
    const key = req.body.filename//config.getKey(req, req.body.filename)
    const { type } = req.body
    if (typeof key !== 'string') {
        return res.status(500).json({ error: 's3: filename returned from `getKey` must be a string' })
    }
    if (typeof type !== 'string') {
        return res.status(400).json({ error: 's3: content type must be a string' })
    }

    s3.createMultipartUpload({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key,
        ACL: process.env.AWS_S3_ACL,
        ContentType: type,
        Expires: ms('5 minutes') / 1000
    }, (err, data) => {
        if (err) {
            next(err)
            return
        }
        res.json({
            key: data.Key,
            uploadId: data.UploadId
        })
    })
}
/**
 * List parts that have been fully uploaded so far.
 *
 * Expected URL parameters:
 *  - uploadId - The uploadId returned from `createMultipartUpload`.
 * Expected query parameters:
 *  - key - The object key in the S3 bucket.
 * Response JSON:
 *  - An array of objects representing parts:
 *     - PartNumber - the index of this part.
 *     - ETag - a hash of this part's contents, used to refer to it.
 *     - Size - size of this part.
 */
function getUploadedParts(req, res, next) {
    // @ts-ignore The `uppy` property is added by middleware before reaching here.
    const { uploadId } = req.params
    const { key } = req.query

    if (typeof key !== 'string') {
        return res.status(400).json({ error: 's3: the object key must be passed as a query parameter. For example: "?key=abc.jpg"' })
    }

    let parts = []
    listPartsPage(0)

    function listPartsPage(startAt) {
        s3.listParts({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: key,
            UploadId: uploadId,
            PartNumberMarker: startAt
        }, (err, data) => {
            if (err) {
                next(err)
                return
            }

            parts = parts.concat(data.Parts)

            if (data.IsTruncated) {
                // Get the next page.
                listPartsPage(data.NextPartNumberMarker)
            } else {
                done()
            }
        })
    }

    function done() {
        res.json(parts)
    }
}
/**
 * Get parameters for uploading one part.
 *
 * Expected URL parameters:
 *  - uploadId - The uploadId returned from `createMultipartUpload`.
 *  - partNumber - This part's index in the file (1-10000).
 * Expected query parameters:
 *  - key - The object key in the S3 bucket.
 * Response JSON:
 *  - url - The URL to upload to, including signed query parameters.
 */
function signPartUpload(req, res, next) {
    // @ts-ignore The `uppy` property is added by middleware before reaching here.
    const { uploadId, partNumber } = req.params
    const { key } = req.query

    if (typeof key !== 'string') {
        return res.status(400).json({ error: 's3: the object key must be passed as a query parameter. For example: "?key=abc.jpg"' })
    }
    if (!parseInt(partNumber, 10)) {
        return res.status(400).json({ error: 's3: the part number must be a number between 1 and 10000.' })
    }

    s3.getSignedUrl('uploadPart', {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: '',
        Expires: ms('5 minutes') / 1000
    }, (err, url) => {
        if (err) {
            next(err)
            return
        }
        res.json({ url })
    })
}
/**
 * Abort a multipart upload, deleting already uploaded parts.
 *
 * Expected URL parameters:
 *  - uploadId - The uploadId returned from `createMultipartUpload`.
 * Expected query parameters:
 *  - key - The object key in the S3 bucket.
 * Response JSON:
 *   Empty.
 */
function abortMultipartUpload(req, res, next) {
    // @ts-ignore The `uppy` property is added by middleware before reaching here.

    const { uploadId } = req.params
    const { key } = req.query

    if (typeof key !== 'string') {
        return res.status(400).json({ error: 's3: the object key must be passed as a query parameter. For example: "?key=abc.jpg"' })
    }

    s3.abortMultipartUpload({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key,
        UploadId: uploadId
    }, (err, data) => {
        if (err) {
            next(err)
            return
        }
        res.json({})
    })
}
/**
 * Complete a multipart upload, combining all the parts into a single object in the S3 bucket.
 *
 * Expected URL parameters:
 *  - uploadId - The uploadId returned from `createMultipartUpload`.
 * Expected query parameters:
 *  - key - The object key in the S3 bucket.
 * Expected JSON body:
 *  - parts - An array of parts, see the `getUploadedParts` response JSON.
 * Response JSON:
 *  - location - The full URL to the object in the S3 bucket.
 */
function completeMultipartUpload(req, res, next) {
    // @ts-ignore The `uppy` property is added by middleware before reaching here.

    const { uploadId } = req.params
    const { key } = req.query
    const { parts } = req.body

    if (typeof key !== 'string') {
        return res.status(400).json({ error: 's3: the object key must be passed as a query parameter. For example: "?key=abc.jpg"' })
    }
    if (!Array.isArray(parts) || !parts.every(isValidPart)) {
        return res.status(400).json({ error: 's3: `parts` must be an array of {ETag, PartNumber} objects.' })
    }

    s3.completeMultipartUpload({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
            Parts: parts
        }
    }, (err, data) => {
        if (err) {
            next(err)
            return
        }
        res.json({
            location: data.Location
        })
    })
}
function isValidPart(part) {
    return part && typeof part === 'object' && typeof part.PartNumber === 'number' && typeof part.ETag === 'string'
}

app.get('/s3/params', getUploadParameters)
app.post('/s3/multipart', createMultipartUpload)
app.get('/s3/multipart/:uploadId', getUploadedParts)
app.get('/s3/multipart/:uploadId/:partNumber', signPartUpload)
app.post('/s3/multipart/:uploadId/complete', completeMultipartUpload)
app.delete('/s3/multipart/:uploadId', abortMultipartUpload)

module.exports = app


