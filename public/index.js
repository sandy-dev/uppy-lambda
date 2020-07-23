const AwsS3 = Uppy.AwsS3,
    AwsS3Multipart = Uppy.AwsS3Multipart;
const uppy = Uppy.Core()
    .use(Uppy.Dashboard, {
        height: 600,
        width: "100%",
        inline: true,
        disableThumbnailGenerator: true,
        showLinkToFileUploadResult: false,
        showProgressDetails: true,
        target: "#drag-drop-area"
    })
    .use(AwsS3Multipart, { // use the AwsS3 plugin                                  
        fields: [], // empty array 
        companionUrl: 'https://fj7qggdbmf.execute-api.us-east-2.amazonaws.com/production/',
    })
    .on("complete", (result) => {
        console.log(result);
        console.log("Upload complete! We’ve uploaded these files:", result.successful);
    })