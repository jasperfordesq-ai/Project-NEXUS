// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Group photo and video gallery (deep React parity audit, 27 Oct 2026, item 5:
 * react-frontend/src/pages/groups/api/media.ts + tabs/GroupMediaTab.tsx).
 *
 * Browse with paging and a photo/video filter, upload an image or video with a
 * caption, delete your own (or, as a group admin, anyone's) after a
 * confirmation page. Media files are private to the group, so the page serves
 * them through this site with the member's own credentials.
 */
const request = require('supertest');

jest.mock('../src/lib/api', () => require('./support/api-mock').apiMockFactory([
  'getGroup', 'getProfile', 'callGroupApi', 'downloadGroupFile', 'uploadGroupMedia'
]));

const api = require('../src/lib/api');
const galleryRoutes = require('../src/routes/group-gallery');
const { groupMediaApp, t } = require('./support/group-media-app');

const multipart = {
  path: /^\/groups\/\d+\/gallery$/,
  options: { maxFileSize: 50 * 1024 * 1024 },
  errorHandler: galleryRoutes.galleryMultipartErrorRedirect
};
const app = groupMediaApp([galleryRoutes], { multipart });

const MEMBER = { data: { id: 974, name: 'Repair crew', viewer_membership: { status: 'active', role: 'member', is_admin: false } } };
const OUTSIDER = { data: { id: 974, name: 'Repair crew', viewer_membership: { status: 'none', role: null, is_admin: false } } };

function mediaItem(overrides = {}) {
  return {
    id: 5,
    group_id: 974,
    type: 'image',
    original_name: 'bench.jpg',
    mime_type: 'image/jpeg',
    url: '/api/v2/groups/974/media?content=5',
    thumbnail_url: null,
    caption: 'The new bench',
    file_size: 2048,
    uploaded_by: 11,
    uploader_name: 'Ann Lee',
    uploader: { id: 11, name: 'Ann Lee', avatar_url: null },
    created_at: '2026-10-20T10:00:00+00:00',
    updated_at: '2026-10-20T10:00:00+00:00',
    capabilities: { can_view: true, can_delete: true },
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 11 } });
  api.getGroup.mockResolvedValue(MEMBER);
  api.callGroupApi.mockResolvedValue({ data: { items: [], cursor: null, has_more: false } });
});

describe('browsing the gallery', () => {
  it('lists one page of photos and videos, newest first, with a link to older ones', async () => {
    api.callGroupApi.mockResolvedValue({
      data: {
        items: [
          mediaItem(),
          mediaItem({ id: 6, type: 'video', original_name: 'opening.mp4', mime_type: 'video/mp4', caption: null, capabilities: { can_view: true, can_delete: false } })
        ],
        cursor: 'Ng==',
        has_more: true
      }
    });

    const res = await request(app).get('/groups/974/gallery');

    expect(res.status).toBe(200);
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/media?per_page=20');
    expect(res.text).toContain(t('govuk_alpha_group_media.gallery.title'));
    expect(res.text).toContain('src="/groups/974/gallery/5/file"');
    expect(res.text).toContain('alt="The new bench"');
    expect(res.text).toContain('Ann Lee');
    expect(res.text).toContain('<video');
    expect(res.text).toContain('href="/groups/974/gallery/6/file"');
    // Delete is offered only where the API says this member may delete.
    expect(res.text).toContain('href="/groups/974/gallery/5/delete"');
    expect(res.text).not.toContain('href="/groups/974/gallery/6/delete"');
    expect(res.text).toContain('href="/groups/974/gallery?cursor=Ng%3D%3D"');
    // The upload form posts multipart to this page.
    expect(res.text).toContain('enctype="multipart/form-data"');
  });

  it('filters by type and keeps the filter while paging', async () => {
    api.callGroupApi.mockResolvedValue({ data: { items: [mediaItem({ type: 'video' })], cursor: 'Mw==', has_more: true } });
    const res = await request(app).get('/groups/974/gallery?type=video&cursor=Ng%3D%3D');
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/media?per_page=20&cursor=Ng%3D%3D&type=video');
    expect(res.text).toContain('href="/groups/974/gallery?type=video&amp;cursor=Mw%3D%3D"');
    expect(res.text).toContain('href="/groups/974/gallery?type=video"');
  });

  it('ignores an unknown type filter instead of sending it to the API', async () => {
    await request(app).get('/groups/974/gallery?type=pdf');
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/media?per_page=20');
  });

  it('shows an empty state', async () => {
    const res = await request(app).get('/groups/974/gallery');
    expect(res.text).toContain(t('govuk_alpha_group_media.gallery.empty_title'));
  });

  it('is not there when the community switched the gallery off', async () => {
    const offApp = groupMediaApp([galleryRoutes], { tenant: { group_tabs: { tab_media: false } } });
    const res = await request(offApp).get('/groups/974/gallery');
    expect(res.status).toBe(404);
    expect(api.getGroup).not.toHaveBeenCalled();
    expect(api.callGroupApi).not.toHaveBeenCalled();
  });

  it('refuses someone who is not a member of the group', async () => {
    api.getGroup.mockResolvedValue(OUTSIDER);
    const res = await request(app).get('/groups/974/gallery');
    expect(res.status).toBe(403);
    expect(api.callGroupApi).not.toHaveBeenCalled();
  });
});

describe('serving a private media file', () => {
  it('streams the file with the member credentials and safe headers', async () => {
    const bytes = Buffer.from('jpeg-bytes');
    api.downloadGroupFile.mockResolvedValue({
      status: 200,
      body: bytes,
      headers: { 'content-type': 'image/jpeg', 'content-disposition': 'inline; filename="bench.jpg"', 'cache-control': 'private, no-store' }
    });
    const res = await request(app).get('/groups/974/gallery/5/file');
    expect(res.status).toBe(200);
    expect(api.downloadGroupFile).toHaveBeenCalledWith('token:test', '/974/media?content=5');
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('answers 404 when the API has no such file', async () => {
    api.downloadGroupFile.mockRejectedValue(new api.ApiError('Not found', 404, {}));
    const res = await request(app).get('/groups/974/gallery/5/file');
    expect(res.status).toBe(404);
  });
});

describe('uploading', () => {
  it('uploads an image with a caption and says so', async () => {
    api.uploadGroupMedia.mockResolvedValue({ data: { id: 9 } });
    const res = await request(app)
      .post('/groups/974/gallery')
      .field('_csrf', 'csrf')
      .field('caption', 'Our stall')
      .attach('file', Buffer.from('fake-png'), { filename: 'stall.png', contentType: 'image/png' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/groups/974/gallery?status=uploaded');
    expect(api.uploadGroupMedia).toHaveBeenCalledWith('token:test', '974', expect.objectContaining({
      caption: 'Our stall',
      file: expect.objectContaining({ filename: 'stall.png', contentType: 'image/png', buffer: expect.any(Buffer) })
    }));
  });

  it('asks for a file when none was chosen', async () => {
    const res = await request(app).post('/groups/974/gallery').type('form').send({ _csrf: 'csrf', caption: '' });
    expect(res.headers.location).toBe('/groups/974/gallery?status=file-missing');
    expect(api.uploadGroupMedia).not.toHaveBeenCalled();
  });

  it('refuses a file that is not an image or video before sending it', async () => {
    const res = await request(app)
      .post('/groups/974/gallery')
      .attach('file', Buffer.from('%PDF'), { filename: 'doc.pdf', contentType: 'application/pdf' });
    expect(res.headers.location).toBe('/groups/974/gallery?status=file-type');
    expect(api.uploadGroupMedia).not.toHaveBeenCalled();
  });

  it('reports a type the API refuses', async () => {
    api.uploadGroupMedia.mockRejectedValue(new api.ApiError('That file type is not allowed', 422, { errors: [{ code: 'VALIDATION_ERROR', field: 'file' }] }));
    const res = await request(app)
      .post('/groups/974/gallery')
      .attach('file', Buffer.from('x'), { filename: 'odd.png', contentType: 'image/png' });
    expect(res.headers.location).toBe('/groups/974/gallery?status=file-type');
  });

  it('reports a file that is too large', async () => {
    api.uploadGroupMedia.mockRejectedValue(new api.ApiError('Too large', 413, { errors: [{ code: 'FILE_TOO_LARGE', field: 'file' }] }));
    const res = await request(app)
      .post('/groups/974/gallery')
      .attach('file', Buffer.from('x'), { filename: 'big.mp4', contentType: 'video/mp4' });
    expect(res.headers.location).toBe('/groups/974/gallery?status=file-too-large');
  });

  it('shows the outcome banner and the field error on return', async () => {
    let res = await request(app).get('/groups/974/gallery?status=uploaded');
    expect(res.text).toContain(t('govuk_alpha_group_media.gallery.states.uploaded'));
    res = await request(app).get('/groups/974/gallery?status=file-type');
    expect(res.text).toContain('govuk-error-summary');
    expect(res.text).toContain('href="#gallery-file"');
    expect(res.text).toContain(t('govuk_alpha_group_media.gallery.states.file-type'));
  });
});

describe('deleting', () => {
  it('asks for confirmation first', async () => {
    const res = await request(app).get('/groups/974/gallery/5/delete');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_group_media.gallery.delete_title'));
    expect(res.text).toContain('action="/groups/974/gallery/5/delete"');
    expect(res.text).toContain('href="/groups/974/gallery"');
    expect(api.callGroupApi).not.toHaveBeenCalledWith('token:test', 'DELETE', expect.anything());
  });

  it('deletes on confirmation', async () => {
    api.callGroupApi.mockResolvedValue({ data: { message: 'Deleted' } });
    const res = await request(app).post('/groups/974/gallery/5/delete').type('form').send({ _csrf: 'csrf' });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'DELETE', '/974/media/5');
    expect(res.headers.location).toBe('/groups/974/gallery?status=deleted');
  });

  it('says when the member may not delete it', async () => {
    api.callGroupApi.mockRejectedValue(new api.ApiError('Forbidden', 403, {}));
    const res = await request(app).post('/groups/974/gallery/5/delete').type('form').send({ _csrf: 'csrf' });
    expect(res.headers.location).toBe('/groups/974/gallery?status=forbidden');
  });
});
