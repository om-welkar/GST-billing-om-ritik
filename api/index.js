import app from '../_system/server.js';

export default function handler(req, res) {
  if (req.url && !req.url.startsWith('/api') && !req.url.startsWith('/_')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return app(req, res);
}
