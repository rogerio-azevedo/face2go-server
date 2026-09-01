/** Códigos de request Dahua/Intelbras usados em AccessFace.cgi / AccessControl. */
export const INTELBRAS_REQUEST_ERROR_CODES: Record<
  string,
  { code: string; description: string }
> = {
  '286064897': {
    code: 'accessControlErrorInvalidCredential',
    description: 'Invalid credentials',
  },
  '286064898': {
    code: 'accessControlErrorInvalidPassword',
    description: 'Wrong password',
  },
  '286064899': {
    code: 'accessControlErrorInvalidFingerprintData',
    description: 'The issued fingerprint data is wrong',
  },
  '286064900': {
    code: 'accessControlErrorInvalidFaceData',
    description: 'The issued face data is wrong',
  },
  '286064901': {
    code: 'accessControlErrorInvalidCardData',
    description: 'The issued card data is incorrect',
  },
  '286064902': {
    code: 'accessControlErrorInvalidUserData',
    description: 'The issued user data is wrong',
  },
  '286064903': {
    code: 'accessControlErrorGetSubServiceFailed',
    description: 'Failed to get capability set sub-service',
  },
  '286064904': {
    code: 'accessControlErrorGetServiceMethodsFailed',
    description: 'Failed to get service method',
  },
  '286064905': {
    code: 'accessControlErrorGetSubCapsFailed',
    description: 'Failed to get sub-capability set',
  },
  '286064912': {
    code: 'accessControlErrorExceedMaxCapacity',
    description: 'Exceeds the maximum capacity of the device',
  },
  '286064913': {
    code: 'accessControlErrorExceedMaxInsertRate',
    description:
      'The maximum insertion speed allowed by the device has been reached',
  },
  '286064914': {
    code: 'accessControlErrorEraseFingerprintFailed',
    description: 'Fingerprint data purge failed when deleting users',
  },
  '286064915': {
    code: 'accessControlErrorEraseFaceFailed',
    description: 'Face data purging fails when deleting users',
  },
  '286064916': {
    code: 'accessControlErrorEraseCardFailed',
    description: 'Card data purging fails when deleting users',
  },
  '286064917': {
    code: 'accessControlErrorNoRecords',
    description: 'Record does not exist',
  },
  '286064918': {
    code: 'accessControlErrorNoMoreRecords',
    description: 'No more records',
  },
  '286064919': {
    code: 'accessControlErrorDuplicateRecord',
    description:
      'The record already exists. The record already exists when the card or fingerprint data is issued.',
  },
  '286064920': {
    code: 'accessControlErrorExceedMaxFingerPrintsPerUser',
    description:
      'Exceeds the maximum number of fingerprints that an user can enroll',
  },
  '286064921': {
    code: 'accessControlErrorExceedMaxCardsPerUser',
    description: 'Exceeds the maximum number of cards that an user can enroll',
  },
  '286064922': {
    code: 'accessControlErrorExtractFaceEigenvalueFailed',
    description: 'Failed to extract face feature value',
  },
  '286064923': {
    code: 'accessControlErrorMaxPhotoFileSizeExceeded',
    description: 'Maximum file size limit exceeded',
  },
  '286064924': {
    code: 'accessControlErrorMaxFacePhotosExceeded',
    description: 'Exceeded maximum number of face photos',
  },
  '286064925': {
    code: 'accessControlErrorRelevantUserNotFound',
    description: 'The User corresponding to the data does not exist',
  },
  '286064926': {
    code: 'accessControlErrorPhotoAlreadyExist',
    description: 'Photo already exists',
  },
  '286064927': {
    code: 'accessControlErrorInvalidPhotoFormat',
    description:
      'The photo is in the wrong format, such as the wrong header of the jpg file',
  },
  '286064928': {
    code: 'accessControlErrorExceedMaxManagerUser',
    description: 'Exceeded maximum number of administrators',
  },
  '286064929': {
    code: 'accessControlErrorUserAlreadyExist',
    description: 'User already exists',
  },
  '286064930': {
    code: 'accessControlErrorCardAlreadyExist',
    description: 'Card number already exists',
  },
  '286064931': {
    code: 'accessControlErrorFingerprintAlreadyExist',
    description: 'Fingerprint already exists',
  },
  '286064932': {
    code: 'accessControlErrorCitizenIDNoAlreadyExist',
    description: 'Citizen ID number already exists',
  },
  '286064933': {
    code: 'accessControlErrorFingerprintDownloadFail',
    description: 'Failed to download fingerprint through URL download method',
  },
  '286064934': {
    code: 'accessControlErrorNotSupportNormalUser',
    description: 'Does not support issue ordinary users',
  },
  '286064935': {
    code: 'accessControlErrorAccountInUse',
    description: 'Account is logging in',
  },
  '268632321': {
    code: 'businessCommonErrorBadRequest',
    description:
      'The state machine of the device, in the C state, the device does not accept the service requests that are only available in the B state.',
  },
  '268632322': {
    code: 'businessCommonErrorInvalidArgs',
    description:
      'The parameter value, quantity, type, range, etc. do not meet the requirements',
  },
  '268632323': {
    code: 'businessCommonErrorInProgress',
    description:
      'The business is being processed, and repeated business requests are not accepted.',
  },
  '268632324': {
    code: 'businessCommonErrorUnKnownError',
    description: 'An unknown error occurred during business processing',
  },
  '268632325': {
    code: 'businessCommonErrorNoResource',
    description:
      'Insufficient resources during processing of business requests',
  },
  '268632326': {
    code: 'businessCommonErrorUnSupported',
    description: 'This service is currently not supported',
  },
  '268632327': {
    code: 'businessCommonErrorTimeout',
    description: 'Business processing timed out',
  },
  '268632328': {
    code: 'businessCommonErrorTooManyRequests',
    description: 'Too many business requests issued',
  },
  '268632329': {
    code: 'businessCommonErrorRequestedTooMuchData',
    description: 'Too much data was fetched for the device to process',
  },
  '268632336': {
    code: 'businessCommonErrorBatchProcessError',
    description: 'An error occurred during the batch execution of the business',
  },
  '268632337': {
    code: 'businessCommonErrorOperationCancelled',
    description: 'For some reason, the business was canceled',
  },
  '268632577': {
    code: 'businessCommonErrorDeviceWarmUP',
    description: 'The device is not ready for business processing',
  },
  '268632578': {
    code: 'businessCommonErrorDeviceInvalid',
    description:
      'The device model is incorrect or due to customization, so that further processing cannot be performed',
  },
  '268632579': {
    code: 'businessCommonErrorDeviceUnavailable',
    description: 'Unable to get device status information',
  },
  '288686080': {
    code: 'faceInfoManagerErrorOtherError',
    description: 'Other errors',
  },
  '288686081': {
    code: 'faceInfoManagerErrorPhotoSizeExceedsLimit',
    description: 'Image size exceeds the limit',
  },
  '288686082': {
    code: 'faceInfoManagerErrorUserNotExist',
    description:
      'User ID does not exist; user data must be sent before the photo',
  },
  '288686083': {
    code: 'faceInfoManagerErrorExtractFeatureFailed',
    description: 'Failed to extract image features',
  },
  '288686084': {
    code: 'faceInfoManagerErrorPhotoExist',
    description: 'Image already exists; an update is required',
  },
  '288686085': {
    code: 'faceInfoManagerErrorPhotoOverFlow',
    description: 'Number of images exceeded the maximum limit',
  },
  '288686086': {
    code: 'faceInfoManagerErrorPhotoFormat',
    description: 'Invalid image format',
  },
  '288686087': {
    code: 'faceInfoManagerErrorDetectFaceNumZero',
    description: 'No face detected',
  },
  '288686088': {
    code: 'faceInfoManagerErrorDetectFaceNumMutil',
    description: 'Multiple faces detected; cannot return features',
  },
  '288686089': {
    code: 'faceInfoManagerErrorPicDec',
    description: 'Error decoding the image',
  },
  '288686090': {
    code: 'faceInfoManagerErrorPicLowerQuailty',
    description: 'Image quality too low',
  },
  '288686091': {
    code: 'faceInfoManagerErrorResultNotRecommended',
    description: 'Result not recommended (e.g. low algorithm confidence)',
  },
  '288686092': {
    code: 'faceInfoManagerErrorFaceFeaturesExist',
    description: 'Face features already exist',
  },
  '288686093': {
    code: 'faceInfoManagerErrorOverAngleThreshold',
    description: 'Face angle exceeds the configured limit',
  },
  '288686094': {
    code: 'faceInfoManagerErrorFaceRatioOOR',
    description:
      'Face ratio outside the recommended range (between 1/3 and 2/3)',
  },
  '288686095': {
    code: 'FaceInfoManagerErrorFaceOverExposure',
    description: 'Face overexposed',
  },
  '288686096': {
    code: 'FaceInfoManagerErrorFaceUnderExposure',
    description: 'Face underexposed',
  },
  '288686097': {
    code: 'FaceInfoManagerErrorFaceLuminanceImbalance',
    description: 'Unbalanced face lighting (e.g. half bright / half dark)',
  },
  '288686098': {
    code: 'FaceInfoManagerErrorFaceLowerConfidence',
    description: 'Low confidence in face detection',
  },
  '288686099': {
    code: 'FaceInfoManagerErrorFaceLowerAlignScore',
    description: 'Low face alignment score',
  },
  '288686100': {
    code: 'FaceInfoManagerErrorFaceOcclusion',
    description: 'Face with obstructions',
  },
  '288686101': {
    code: 'FaceInfoManagerErrorLowerEyesDistance',
    description: 'Distance between eyes below the limit',
  },
  '288686102': {
    code: 'FaceInfoManagerErrorDownloadFail',
    description: 'Failed to download the face image via URL',
  },
  '288686103': {
    code: 'FaceInfoManagerErrorPhotoFFE',
    description: 'Face detected, but feature extraction failed',
  },
  '288686104': {
    code: 'FaceInfoManagerErrorPhotoFAFilteration',
    description: 'Face filtered by attributes (e.g. mask, glasses, hat, age)',
  },
  '288686105': {
    code: 'FaceInfoManagerErrorPhotoIncomplete',
    description: 'Incomplete face image',
  },
  '288686106': {
    code: 'FaceInfoManagerErrorFaceFeaturesize',
    description: 'Invalid feature size',
  },
  '288686107': {
    code: 'FaceInfoManagerErrorInvalidFeature',
    description: 'Invalid feature',
  },
  '288686108': {
    code: 'faceInfoManagerErrorAddUserRecordFail',
    description: 'Failed to add user record',
  },
  '288686109': {
    code: 'faceInfoManagerErrorUpdateUserFail',
    description: 'Failed to update user',
  },
  '288686110': {
    code: 'faceInfoManagerErrorUpdateRoomInfoFail',
    description: 'Failed to update room information',
  },
};

/** Envelope de lote — o motivo real está em detail.FailCodes. */
export const INTELBRAS_BATCH_PROCESS_ERROR_CODE = 268632336;
