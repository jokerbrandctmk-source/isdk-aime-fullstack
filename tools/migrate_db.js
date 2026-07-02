const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

function slugify(value) {
  return String(value || 'custom-anime')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'custom-anime';
}

function ensureUserChannel(db, user) {
  db.channels = db.channels || [];
  const existing = db.channels.find((c) => c.userId === user.id || String(c.username || '').toLowerCase() === String(user.email || user.username || '').toLowerCase());
  if (existing) return existing;
  const slugBase = slugify(user.displayName || user.username || `creator-${user.id}`);
  const slug = `${slugBase}-${String(user.id).slice(-4)}`;
  const channel = {
    id: `ch_${crypto.randomUUID()}`,
    userId: user.id,
    slug,
    name: user.displayName || user.username || 'Creator Channel',
    username: user.username || `creator${String(user.id).slice(-4)}`,
    profilePicture: user.photoURL || '',
    banner: '',
    about: 'New creator on ISKD Anime.',
    socialLinks: [],
    website: '',
    country: '',
    joinDate: new Date().toISOString(),
    creatorBadge: true,
    verified: false,
    subscribers: 0,
    totalViews: 0,
    totalWatchTime: 0,
    totalRevenue: 0,
    totalVideos: 0,
    totalLikes: 0,
    totalComments: 0,
    monetizationStatus: 'Pending',
    verificationStatus: 'Pending',
    isActive: true,
    createdAt: new Date().toISOString()
  };
  db.channels.push(channel);
  return channel;
}

function findUserByEmailOrName(db, value) {
  if (!value) return null;
  const v = String(value).toLowerCase();
  return (db.users || []).find((u) => (u.email && String(u.email).toLowerCase() === v) || (u.username && String(u.username).toLowerCase() === v));
}

async function migrate() {
  const raw = await fs.readFile(DB_PATH, 'utf8');
  const db = JSON.parse(raw);

  db.channels = db.channels || [];
  db.subscribers = db.subscribers || {};
  db.revenue = db.revenue || [];
  db.comments = db.comments || {};

  // Ensure channel for each user
  for (const user of db.users || []) {
    ensureUserChannel(db, user);
  }

  // Map anime to channels and users
  for (const anime of db.anime || []) {
    // If anime has createdByName that looks like an email, try to link
    if (anime.createdByName && !anime.createdBy) {
      const matched = findUserByEmailOrName(db, anime.createdByName);
      if (matched) {
        anime.createdBy = matched.id;
        const channel = ensureUserChannel(db, matched);
        anime.createdByChannel = channel.slug;
        anime.createdByName = matched.email || matched.username || matched.displayName || anime.createdByName;
      }
    }

    // If createdBy is present but createdByChannel missing, try to set
    if (anime.createdBy && !anime.createdByChannel) {
      const owner = (db.users || []).find((u) => u.id === anime.createdBy);
      if (owner) {
        const channel = ensureUserChannel(db, owner);
        anime.createdByChannel = channel.slug;
      }
    }
  }

  // Recalculate channel stats
  for (const channel of db.channels) {
    channel.totalVideos = 0;
    channel.totalViews = 0;
    channel.totalLikes = 0;
    channel.totalComments = 0;
    channel.totalWatchTime = 0;
  }

  // Count videos/views/likes/comments per channel
  for (const anime of db.anime || []) {
    const ownerId = anime.createdBy;
    const ownerUser = (db.users || []).find((u) => u.id === ownerId);
    let channel = null;
    if (ownerUser) channel = (db.channels || []).find((c) => c.userId === ownerUser.id);
    if (!channel && anime.createdByChannel) channel = (db.channels || []).find((c) => c.slug === anime.createdByChannel);
    if (!channel && ownerUser) channel = ensureUserChannel(db, ownerUser);
    if (!channel) continue;

    channel.totalVideos = (channel.totalVideos || 0) + 1;
    channel.totalViews = (channel.totalViews || 0) + Number(anime.views || 0);
    channel.totalLikes = (channel.totalLikes || 0) + Number(anime.likes || 0);

    // Count comments for episodes
    for (const ep of anime.episodes || []) {
      const list = db.comments && db.comments[ep.id] ? db.comments[ep.id] : [];
      channel.totalComments = (channel.totalComments || 0) + list.length;
    }
  }

  // Recalculate subscribers from db.subscribers mapping
  for (const channel of db.channels) {
    const list = (db.subscribers && Array.isArray(db.subscribers[channel.id])) ? db.subscribers[channel.id] : [];
    channel.subscribers = list.length;
  }

  // Write back
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2) + '\n', 'utf8');
  console.log('Migration complete. Updated', DB_PATH);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
