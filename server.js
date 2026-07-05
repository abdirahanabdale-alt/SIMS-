const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI environment variable is not set.');
  console.error('Please set MONGODB_URI in your Render.com environment variables.');
  process.exit(1);
}

mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Mongoose models
const StationSchema = new mongoose.Schema({
  name: String,
  type: { type: String, enum: ['Airport', 'Seaport', 'Border_Crossing'] }
});
const Station = mongoose.model('Station', StationSchema);

const PostSchema = new mongoose.Schema({
  name: String,
  station_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Station' }
});
const Post = mongoose.model('Post', PostSchema);

const UserSchema = new mongoose.Schema({
  full_name: String,
  email: String,
  password: { type: String, default: '123456' },
  role: { type: String, enum: ['admin', 'officer', 'traveler'] },
  gender: String,
  address: String,
  passport_number: String,
  nationality: String,
  profile_pic: { type: String, default: 'default.png' },
  station_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Station' },
  session_id: String
});
const User = mongoose.model('User', UserSchema);

const BorderLogSchema = new mongoose.Schema({
  traveler_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  post_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  station_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Station' },
  crossing_type: { type: String, enum: ['Entry', 'Exit'] },
  date: String
});
const BorderLog = mongoose.model('BorderLog', BorderLogSchema);

const VisaAppSchema = new mongoose.Schema({
  traveler_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  post_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  duration_days: Number
});
const VisaApp = mongoose.model('VisaApp', VisaAppSchema);

const PermitRequestSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  role: String,
  date: String,
  message: String,
  status: { type: String, default: 'Pending' },
  created_at: { type: Date, default: Date.now }
});
const PermitRequest = mongoose.model('PermitRequest', PermitRequestSchema);

const NotificationSchema = new mongoose.Schema({
  message: String,
  type: String,
  created_at: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', NotificationSchema);

const FeedbackSchema = new mongoose.Schema({
  traveler_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  message: String,
  created_at: { type: Date, default: Date.now }
});
const Feedback = mongoose.model('Feedback', FeedbackSchema);

// Initialize admin user
async function initAdmin() {
  const adminExists = await User.findOne({ role: 'admin' });
  if (!adminExists) {
    await User.create({
      email: 'admin@immigration.gov.so',
      password: '123456',
      role: 'admin',
      full_name: 'HQ Administrator'
    });
    console.log('Admin user created');
  }
}

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'secret_key_sims',
  resave: false,
  saveUninitialized: true
}));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files (CSS, JS, images)
app.use(express.static(path.join(__dirname, 'public')));

// Require auth middleware
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// Routes
app.get('/', (req, res) => {
  res.redirect('/app');
});

app.get('/login', (req, res) => {
  res.render('login', { error: req.query.error });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email, password });
  if (user) {
    req.session.user = user;
    res.redirect('/app?page=dashboard');
  } else {
    res.redirect('/login?error=Invalid credentials');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Single app handler for both GET and POST
app.all('/app', requireAuth, async (req, res) => {
  try {
    const success_msg = req.query.msg;
    const page = req.query.page || 'dashboard';
    const user = req.session.user;

    // Handle deletions via GET query params
    if (req.query.delete && req.query.table && req.query.id) {
      const { table, id } = req.query;
      if (table === 'station') await Station.findByIdAndDelete(id);
      if (table === 'post') await Post.findByIdAndDelete(id);
      if (table === 'user') await User.findByIdAndDelete(id);
      return res.redirect(`/app?page=${page}&msg=Record deleted successfully.`);
    }

    // Handle POST actions
    if (req.method === 'POST') {
      const { action } = req.body;
      let success_msg = 'Action completed';

      switch (action) {
        case 'add_station':
          await Station.create({ name: req.body.name, type: req.body.type });
          success_msg = 'Station added';
          break;
        case 'add_post':
          await Post.create({ name: req.body.name, station_id: req.body.station_id });
          success_msg = 'Post added';
          break;
        case 'add_officer':
          await User.create({ ...req.body, role: 'officer' });
          success_msg = 'Officer added';
          break;
        case 'add_traveler':
          await User.create({ ...req.body, role: 'traveler' });
          success_msg = 'Traveler added';
          break;
        case 'save_logs':
          const { date, station_id, post_id, crossing_type } = req.body;
          await BorderLog.deleteMany({ date, post_id, station_id });
          for (const traveler_id of Object.keys(crossing_type)) {
            await BorderLog.create({
              traveler_id,
              post_id,
              station_id,
              crossing_type: crossing_type[traveler_id],
              date
            });
          }
          success_msg = 'Crossing logs saved';
          break;
        case 'save_visas':
          const { post_id: visa_post_id, duration_days } = req.body;
          for (const traveler_id of Object.keys(duration_days)) {
            const days = duration_days[traveler_id];
            if (days) {
              await VisaApp.findOneAndUpdate(
                { traveler_id, post_id: visa_post_id },
                { duration_days: days },
                { upsert: true, new: true }
              );
            }
          }
          success_msg = 'Visa durations saved';
          break;
        case 'apply_permit':
          await PermitRequest.create({
            user_id: user._id,
            role: user.role,
            date: req.body.date,
            message: req.body.message
          });
          success_msg = 'Permit request submitted';
          break;
        case 'update_permit':
          await PermitRequest.findByIdAndUpdate(req.body.permit_id, { status: req.body.status });
          success_msg = 'Permit status updated';
          break;
        case 'send_notification':
          await Notification.create({ message: req.body.message, type: req.body.type });
          success_msg = 'Notification sent';
          break;
        case 'send_feedback':
          await Feedback.create({ traveler_id: user._id, message: req.body.message });
          success_msg = 'Feedback submitted';
          break;
      }
      return res.redirect(`/app?page=${page}&msg=${success_msg}`);
    }

    // For GET rendering, prepare data
    const data = {
      user,
      page,
      success_msg,
      stations: [],
      posts: [],
      fetched_travelers: [],
      visa_travelers: [],
      existing_logs: {},
      existing_visas: {},
      officers: [],
      travelers: [],
      permits: [],
      notifs: [],
      my_permits: [],
      logs: [],
      my_logs: [],
      visas: [],
      total_travelers: 0,
      total_officers: 0,
      total_stations: 0,
      total_posts: 0,
      log_count: 0,
      total_entries: 0,
      total_crossings: 0
    };

    // Always fetch stations and posts
    data.stations = await Station.find();
    data.posts = await Post.find().populate('station_id');

    // Page-specific data fetching
    if (page === 'dashboard') {
      data.total_travelers = await User.countDocuments({ role: 'traveler' });
      data.total_officers = await User.countDocuments({ role: 'officer' });
      data.total_stations = await Station.countDocuments();
      data.total_posts = await Post.countDocuments();
      data.log_count = await BorderLog.countDocuments();
      if (user.role === 'traveler') {
        data.total_entries = await BorderLog.countDocuments({ traveler_id: user._id, crossing_type: 'Entry' });
        data.total_crossings = await BorderLog.countDocuments({ traveler_id: user._id });
      }
    } else if (page === 'manage_officers') {
      data.officers = await User.find({ role: 'officer' });
    } else if (page === 'manage_travelers') {
      data.travelers = await User.find({ role: 'traveler' }).populate('station_id');
    } else if (page === 'manage_crossings' || page === 'log_crossings') {
      const { fetch_station, fetch_date, fetch_post } = req.query;
      if (fetch_station && fetch_date && fetch_post) {
        data.fetched_travelers = await User.find({ role: 'traveler' });
        const logs = await BorderLog.find({ date: fetch_date, post_id: fetch_post });
        data.existing_logs = {};
        logs.forEach(log => {
          data.existing_logs[log.traveler_id] = log.crossing_type;
        });
      }
    } else if (page === 'manage_visas') {
      const { fetch_station, fetch_post } = req.query;
      if (fetch_station && fetch_post) {
        data.visa_travelers = await User.find({ role: 'traveler' });
        const visas = await VisaApp.find({ post_id: fetch_post });
        data.existing_visas = {};
        visas.forEach(visa => {
          data.existing_visas[visa.traveler_id] = visa.duration_days;
        });
      }
    } else if (page === 'notifications' && user.role === 'admin') {
      data.permits = await PermitRequest.find().populate('user_id').sort({ created_at: -1 });
    } else if (page === 'officer_notifs' || page === 'traveler_notifs') {
      const type = page === 'officer_notifs' ? 'officer' : 'traveler';
      data.notifs = await Notification.find({ type }).sort({ created_at: -1 });
    } else if (page === 'apply_permit') {
      data.my_permits = await PermitRequest.find({ user_id: user._id }).sort({ created_at: -1 });
    } else if (page === 'view_logs' && user.role === 'officer') {
      data.logs = await BorderLog.find().populate('traveler_id').populate('post_id').sort({ date: -1 }).limit(50);
    } else if (page === 'my_history' && user.role === 'traveler') {
      data.my_logs = await BorderLog.find({ traveler_id: user._id }).populate('post_id').sort({ date: -1 });
    } else if (page === 'visa_status' && user.role === 'traveler') {
      data.visas = await VisaApp.find({ traveler_id: user._id }).populate('post_id');
    }

    res.render('app', data);
  } catch (err) {
    console.error('App handler error:', err);
    res.status(500).send('Server error');
  }
});

// 404 route
app.use((req, res) => {
  res.status(404).send('Page not found');
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  initAdmin();
});
