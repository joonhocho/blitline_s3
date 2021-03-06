/* eslint camelcase: 0 */
import blitline from 'simple_blitline_node';
import http from 'http';
import path from 'path';

const TIMEOUT = 30 * 1000; // 30 seconds

/*

JobResponse {
  results: [{
    images: [{
      image_identifier: String!
      s3_url: String!
    }]
    job_id: String!
    error: String
  }]
}

PollingResponse {
  results: {
    original_meta: {
      width: Number!
      height: Number!
    }
    images: [{
      image_identifier: String!
      s3_url: String!
      meta: {
        width: Number!
        height: Number!
      }
    }]
    job_id: String!
  }
}

*/

const pollJob = (jobId) =>
  new Promise((resolve, reject) => {
    const req = http.get({
      host: 'cache.blitline.com',
      port: 80,
      path: `/listen/${jobId}`,
    }, (res) => {
      res.setEncoding('utf8');
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const data = JSON.parse(chunks.join(''));
          const results = JSON.parse(data.results);
          resolve(results);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
    req.setTimeout(TIMEOUT, reject);
  });


const pollFromJobResponse = (response) =>
  pollJob(response.results[0].job_id);


export default (config, jobOptions) => {
  let {
    APPLICATION_ID,
    BUCKET,
    NAME_PREFIX,
  } = config;

  if (!APPLICATION_ID) {
    throw new Error(`'APPLICATION_ID' must be provided.`);
  }

  if (!BUCKET) {
    throw new Error(`'BUCKET' must be provided.`);
  }

  if (!NAME_PREFIX) NAME_PREFIX = '';

  const uriPrefix = `https://${BUCKET}.s3.amazonaws.com/${NAME_PREFIX}`;

  return (uri, funcMap, options) => {
    if (!uri) {
      throw new Error(`'uri' must be provided.`);
    }

    blitline.addJob({
      ...jobOptions,
      application_id: APPLICATION_ID,
      ...options,
      src: uri,
      functions: Object.keys(funcMap).map((key) => {
        const func = funcMap[key];
        let {save} = func;
        if (!save) {
          const {name, ext} = path.parse(uri);
          save = `${name}_${key}${ext}`;
        }
        if (typeof save === 'string') {
          return {
            ...func,
            save: {
              image_identifier: key,
              s3_destination: {
                bucket: BUCKET,
                key: NAME_PREFIX + save,
              },
            },
          };
        }
        return func;
      }),
    });

    return blitline.postJobs()
      .then(pollFromJobResponse)
      .then(({job_id, original_meta, images}) => ({
        jobId: job_id,
        images: images.reduce((obj, {image_identifier, s3_url, meta}) => {
          obj[image_identifier] = {
            uri: uriPrefix + path.basename(s3_url),
            meta,
          };
          return obj;
        }, {
          original: {
            uri,
            meta: original_meta,
          },
        }),
      }));
  };
};
