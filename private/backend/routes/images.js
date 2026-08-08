const { Router } = require('express');
const { PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const content = require('../content.js');
const { requireAdmin } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');
const { s3Client, S3_BUCKET } = require('../shared/clients.js');

const router = Router();

// Images for roundtable/initiative cards and banners. Stored in the same
// public S3 bucket that serves the front-end, so uploaded images are
// reachable at a root-relative URL through the existing CloudFront default
// behavior — no separate hosting or cache-behavior setup needed.
const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024; // keeps the base64 payload under the 6MB Lambda request-payload limit

router.post(
  '/api/admin/uploads',
  requireAdmin,
  asyncRoute(async (req, res) => {
    if (!s3Client) {
      return res.status(503).json({ error: 'Image uploads are not configured.' });
    }
    const { filename, contentType, dataBase64 } = req.body || {};
    if (!filename || !contentType || !dataBase64) {
      return res.status(400).json({ error: 'Missing filename, contentType, or image data.' });
    }
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'Only image uploads are allowed.' });
    }
    const buffer = Buffer.from(dataBase64, 'base64');
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: 'Image is too large. Please use a file under 3.5MB.' });
    }
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
    const key = `uploads/${Date.now()}-${Math.floor(Math.random() * 1000000)}-${safeName}`;
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    const url = `/${key}`;
    const image = await content.createImage({ url, filename, contentType, size: buffer.length });
    res.status(201).json(image);
  }, 'Unable to upload image.')
);

router.get(
  '/api/admin/images',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await content.listImages());
  }, 'Unable to load images.')
);

router.get(
  '/api/admin/stock-images',
  requireAdmin,
  asyncRoute(async (req, res) => {
    if (!s3Client) {
      return res.json([]);
    }
    const result = await s3Client.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: 'imgs/stock/',
    }));
    const images = (result.Contents || [])
      .filter((obj) => obj.Key !== 'imgs/stock/')
      .map((obj) => ({
        url: `/${obj.Key}`,
        filename: obj.Key.split('/').pop(),
      }));
    res.json(images);
  }, 'Unable to load stock images.')
);

module.exports = router;
