var AWS = require('aws-sdk'),
    region = "us-east-2",
    secretName = "access/secret",
    secret,
    decodedBinarySecret

module.exports.SecretsManager = (secretName) => {
    var client = new AWS.SecretsManager({
        region: region
    })
    client.getSecretValue({ SecretId: secretName }, function (err, data) {
        if (err) {
            if (err.code === 'DecryptionFailureException')
                throw err
            else if (err.code === 'InternalServiceErrorException')
                throw err
            else if (err.code === 'InvalidParameterException')
                throw err
            else if (err.code === 'InvalidRequestException')
                throw err
            else if (err.code === 'ResourceNotFoundException')
                throw err
        }
        else {
            if ('SecretString' in data) {
                secret = data.SecretString
            } else {
                let buff = new Buffer(data.SecretBinary, 'base64')
                decodedBinarySecret = buff.toString('ascii')
            }
        }
    })
}