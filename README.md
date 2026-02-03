# Pair API

A Next.js serverless API for the Pair music pairing app. This API handles Spotify integration, the hybrid pairing algorithm, and social features.

## Features

- Spotify track search and audio features
- Hybrid pairing algorithm with multiple modes (Same Sound, Same Vibe, Same Scene, Adventure)
- Social features: playlists, follows, likes, feed
- Supabase integration for data persistence

## API Endpoints

### Spotify
- `GET /api/spotify/search?q=...` - Search tracks by name
- `GET /api/spotify/audio-features?ids=...` - Get audio features for tracks

### Pairing
- `POST /api/pair` - Generate music pairings based on a seed track

### Social
- `GET/POST /api/playlists` - List/create playlists
- `GET /api/playlists/[id]` - Get playlist details
- `POST /api/playlists/[id]/publish` - Publish a playlist
- `GET /api/feed` - Get feed for authenticated user
- `POST /api/follow` - Follow/unfollow users
- `POST /api/like` - Like/unlike playlists
- `GET/POST /api/profiles` - Get/create user profiles
- `GET/POST/DELETE /api/saved-tracks` - Manage saved tracks

## Setup

### Prerequisites
- Node.js 18+
- Spotify Developer Account
- Supabase Project
- OpenAI API Key (for embeddings)

### Environment Variables

Create a `.env.local` file:

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=pair://spotify-callback

OPENAI_API_KEY=your_openai_api_key

SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SUPABASE_ANON_KEY=your_supabase_anon_key

APP_JWT_SECRET=your_jwt_secret
```

### Database Setup

Run the SQL migration in your Supabase SQL editor:

```bash
# The migration file is at:
supabase/migrations/001_initial_schema.sql
```

### Installation

```bash
npm install
npm run dev
```

The API will be available at `http://localhost:3000`.

## Deployment

Deploy to Vercel:

```bash
vercel
```

Make sure to set all environment variables in your Vercel project settings.

## Pairing Algorithm

The pairing algorithm uses a hybrid approach:

1. **Candidate Generation**: Fetches 150-300 candidates from Spotify Recommendations and related artists' top tracks
2. **Audio Feature Similarity**: Weighted cosine similarity over normalized audio features
3. **Vibe Similarity**: OpenAI embeddings for semantic matching with user prompts
4. **Mode-based Scoring**: Different weights for sound, vibe, novelty, and scene based on selected mode
5. **Diversity Rule**: Max 2 tracks per artist in top 20 results

### Mode Weights

| Mode | Sound | Vibe | Novelty | Scene |
|------|-------|------|---------|-------|
| Same Sound | 0.70 | 0.15 | 0.15 | 0 |
| Same Vibe | 0.45 | 0.40 | 0.15 | 0 |
| Same Scene | 0.35 | 0.25 | 0 | 0.40 |
| Adventure | 0.35 | 0.35 | 0.30 | 0 |

## License

MIT
