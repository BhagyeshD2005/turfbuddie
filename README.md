# TurfBuddie — Node.js + Google Sheets

Full-stack turf booking app. Uses **Google Sheets as the database** via the Sheets API + a service account.

---

## ⚡ Quick Start

### 1. Create a Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) → create a new spreadsheet
2. Copy the **Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/  ← THIS PART →  /edit
   ```

### 2. Create a Service Account

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (or use existing)
3. Enable **Google Sheets API**: APIs & Services → Enable APIs → search "Sheets"
4. Go to **IAM & Admin → Service Accounts** → Create Service Account
5. Give it any name, click Done
6. Click the service account → **Keys** tab → Add Key → JSON → Download
7. Open the JSON file — keep it safe, you'll need it below

### 3. Share your Sheet with the service account

1. Open the service account JSON — find `"client_email"` (looks like `name@project.iam.gserviceaccount.com`)
2. In your Google Sheet → Share → paste that email → Editor role → Share

### 4. Configure environment

```bash
# Copy the service-account JSON file into the project folder
cp ~/Downloads/my-key.json turfbuddie/service-account.json

# Set env vars
export SPREADSHEET_ID="your-sheet-id-here"
export GOOGLE_KEY_FILE="./service-account.json"

# Optional
export RAZORPAY_KEY="rzp_test_xxxx"
export FIREBASE_API_KEY="AIza..."
export MAPS_API_KEY="AIza..."
```

> **Tip:** You can also inline the JSON as one line:
> ```bash
> export GOOGLE_SERVICE_ACCOUNT='{"type":"service_account","project_id":...}'
> ```

### 5. Install & set up sheets

```bash
npm install
node server.js --setup    # Creates Turf_Master, Bookings, Users, Reservations tabs + sample data
```

### 6. Run

```bash
npm start
# → http://localhost:3000
```

---

## 📁 Project Structure

```
turfbuddie/
├── server.js          # Express + Google Sheets API
├── package.json
└── public/
    └── index.html     # Full frontend (HTML + CSS + JS)
```

---

## 🌐 API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/config` | Razorpay key + Firebase config |
| GET | `/api/turfs` | All active turfs from Turf_Master |
| POST | `/api/availability` | Slot status for a turf + date |
| POST | `/api/reserve` | Hold slots for 5 min (writes to Reservations) |
| POST | `/api/release` | Cancel a reservation |
| POST | `/api/booking/create` | Confirm booking (writes to Bookings) |
| POST | `/api/bookings` | User's booking history |
| POST | `/api/booking/cancel` | Cancel a booking |
| GET | `/api/profile?email=` | Fetch user profile |
| POST | `/api/profile/save` | Save profile (writes to Users) |

---

## 📊 Sheet Structure

**Turf_Master** — edit here to add/remove turfs
| Turf_ID | Name | Location | Base_Price | Open_Time | Close_Time | Status | Image_URL | Lat | Lng | Rating | Review_Count |

**Bookings** — auto-filled on every booking
| Booking_ID | Timestamp | User_Name | Phone | Email | Turf_ID | Date | Time_Slot | Amount | Booking_Status | Razorpay_Payment_ID |

**Users** — auto-filled on signup / profile save
| Email | Name | Phone | City | Created_At | Last_Updated |

**Reservations** — 5-min holds; ExpiresAt=0 means released
| Reservation_ID | Turf_ID | Date | Slots | ExpiresAt |

---

## ✨ Features

- Real-time slot availability from Google Sheets
- Multi-slot booking (up to 6 consecutive hours)
- 5-minute hold timer with automatic expiry
- Razorpay payments (demo mode if no key)
- Firebase Auth (email + Google Sign-in)
- Google Maps integration (optional)
- My Bookings: Upcoming / Past / Cancelled
- User profile + favourite turfs
- Photo lightbox with keyboard navigation
- Filters: city, price, rating, distance sort
- Fully responsive / mobile-friendly
