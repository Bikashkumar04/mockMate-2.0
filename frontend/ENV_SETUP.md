# Frontend Environment Configuration Guide

## Required Environment Variables

### 1. Backend API URL
```bash
NEXT_PUBLIC_API_URL=http://localhost:8080
```
- Points to your FastAPI backend
- For production: Update to your backend deployment URL
- **No trailing slash**

### 2. Better Auth Secret
```bash
BETTER_AUTH_SECRET=<generate-random-secret>
```
Generate a secure random secret:
```bash
openssl rand -base64 32
```
Or use Node.js:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. Better Auth URL
```bash
BETTER_AUTH_URL=http://localhost:3000
```
- For local development: `http://localhost:3000`
- For production: Your Vercel deployment URL (e.g., `https://mockmate.vercel.app`)

### 4. Google OAuth Credentials

**Get your credentials:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project or select existing
3. Enable "Google+ API"
4. Create OAuth 2.0 Client ID
5. Set authorized redirect URIs:
   - Local: `http://localhost:3000/api/auth/callback/google`
   - Production: `https://yourdomain.com/api/auth/callback/google`

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

### 5. MongoDB Database

Must match your backend database configuration:

```bash
MONGODB_URI=mongodb://localhost:27017
MONGODB_DATABASE=mockmate
```

### 6. Polar (Optional - Monetization)

Only needed if using Polar for payments:
```bash
POLAR_ACCESS_TOKEN=polar_xxx
POLAR_SUCCESS_URL=https://yourdomain.com/success
```

---

## Quick Setup

1. **Copy the example file:**
   ```bash
   cd frontend
   cp .env.example .env.local
   ```

2. **Generate Better Auth Secret:**
   ```bash
   openssl rand -base64 32
   ```

3. **Update .env.local with your values**

4. **Start the development server:**
   ```bash
   npm run dev
   ```

---

## Production Deployment (Vercel)

Add these environment variables in your Vercel project settings:

1. Go to your project → Settings → Environment Variables
2. Add all variables from `.env.local`
3. Update URLs:
   - `BETTER_AUTH_URL` → Your Vercel domain
   - `NEXT_PUBLIC_API_URL` → Your Cloud Run backend URL
4. Redeploy

---

## Troubleshooting

### "BETTER_AUTH_SECRET is not defined"
- Make sure `.env.local` exists in the `frontend/` directory
- Restart the Next.js dev server after creating the file

### "Failed to connect to MongoDB"
- Check your MongoDB instance is running
- Verify `MONGODB_URI` and `MONGODB_DATABASE`
- Ensure network access is allowed for your deployment environment

### "Google OAuth error"
- Verify redirect URIs in Google Cloud Console match exactly
- Check client ID and secret are correct
- Ensure Google+ API is enabled

### "NEXT_PUBLIC_API_URL connection refused"
- Make sure backend is running: `cd backend && uvicorn main:app --reload`
- Check backend is on port 8080 or update the URL

---

## Security Notes

⚠️ **NEVER commit `.env.local` to Git**
- Already included in `.gitignore`
- Contains sensitive credentials

⚠️ **Use different secrets for production**
- Generate new `BETTER_AUTH_SECRET` for each environment
- Use separate Google OAuth credentials for dev/prod
- Use strong database credentials

---

## File Locations

- Development config: `frontend/.env.local`
- Example template: `frontend/.env.example`
- Auth setup: `frontend/src/lib/auth.ts`
- Auth client: `frontend/src/lib/auth-client.ts`
