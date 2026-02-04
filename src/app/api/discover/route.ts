import { NextResponse } from "next/server";
import { searchAppleMusicTracks } from "@/lib/appleMusic";

// Curated playlist definitions with search queries for each track
const curatedPlaylistDefinitions = [
  {
    id: "late-night-drive",
    title: "Late Night Drive",
    description: "Empty highways, city lights fading. That feeling when you're driving nowhere in particular.",
    curatorName: "Alex Chen",
    genres: ["Electronic", "Indie"],
    emotions: ["Nostalgic", "Dreamy"],
    trackQueries: [
      { query: "Nightcall Kavinsky", artist: "Kavinsky" },
      { query: "Midnight City M83", artist: "M83" },
      { query: "Under Cover of Darkness The Strokes", artist: "The Strokes" },
      { query: "Hyperballad Bjork", artist: "Bjork" },
      { query: "Such Great Heights The Postal Service", artist: "The Postal Service" },
    ],
  },
  {
    id: "gentle-morning",
    title: "Gentle Morning",
    description: "Sunday morning light through curtains. Coffee brewing, world still quiet.",
    curatorName: "Maya Patel",
    genres: ["Folk", "Indie"],
    emotions: ["Intimate", "Melancholic"],
    trackQueries: [
      { query: "Holocene Bon Iver", artist: "Bon Iver" },
      { query: "Skinny Love Bon Iver", artist: "Bon Iver" },
      { query: "The Night We Met Lord Huron", artist: "Lord Huron" },
      { query: "First Day of My Life Bright Eyes", artist: "Bright Eyes" },
      { query: "re: stacks Bon Iver", artist: "Bon Iver" },
    ],
  },
  {
    id: "velvet-grooves",
    title: "Velvet Grooves",
    description: "Smooth R&B for late nights. Let the rhythm carry you somewhere warm.",
    curatorName: "Marcus Reid",
    genres: ["R&B", "Soul"],
    emotions: ["Intimate", "Dreamy"],
    trackQueries: [
      { query: "Untitled How Does It Feel D'Angelo", artist: "D'Angelo" },
      { query: "Electric Alina Baraz Khalid", artist: "Alina Baraz & Khalid" },
      { query: "Best Part Daniel Caesar H.E.R.", artist: "Daniel Caesar" },
      { query: "Adorn Miguel", artist: "Miguel" },
      { query: "Prototype OutKast", artist: "OutKast" },
    ],
  },
  {
    id: "jazz-after-dark",
    title: "Jazz After Dark",
    description: "Smoky rooms and dim lights. The kind of jazz that makes time slow down.",
    curatorName: "Jordan Park",
    genres: ["Jazz"],
    emotions: ["Melancholic", "Intimate"],
    trackQueries: [
      { query: "Blue in Green Miles Davis", artist: "Miles Davis" },
      { query: "In a Sentimental Mood Duke Ellington John Coltrane", artist: "Duke Ellington & John Coltrane" },
      { query: "My Favorite Things John Coltrane", artist: "John Coltrane" },
      { query: "Round Midnight Thelonious Monk", artist: "Thelonious Monk" },
      { query: "Naima John Coltrane", artist: "John Coltrane" },
    ],
  },
  {
    id: "indie-heartbreak",
    title: "Indie Heartbreak",
    description: "Songs for staring out windows. When feelings need a soundtrack.",
    curatorName: "Emma Wilson",
    genres: ["Indie", "Rock"],
    emotions: ["Melancholic", "Nostalgic"],
    trackQueries: [
      { query: "Motion Picture Soundtrack Radiohead", artist: "Radiohead" },
      { query: "The Funeral Band of Horses", artist: "Band of Horses" },
      { query: "Lua Bright Eyes", artist: "Bright Eyes" },
      { query: "Fake Plastic Trees Radiohead", artist: "Radiohead" },
      { query: "Between the Bars Elliott Smith", artist: "Elliott Smith" },
    ],
  },
];

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export async function GET() {
  try {
    const playlists = await Promise.all(
      curatedPlaylistDefinitions.map(async (playlist) => {
        // Fetch real track data from Apple Music for each track in the playlist
        const tracks = await Promise.all(
          playlist.trackQueries.map(async (trackQuery) => {
            const results = await searchAppleMusicTracks(trackQuery.query, 1);
            if (results.length > 0) {
              const track = results[0];
              return {
                id: track.apple_music_id,
                name: track.track_name,
                artist: track.artist_name,
                duration: track.duration_ms ? formatDuration(track.duration_ms) : "0:00",
                artworkUrl: track.album_art_url || "",
                previewUrl: track.preview_url || "",
              };
            }
            // Fallback if track not found
            return {
              id: `fallback-${trackQuery.query}`,
              name: trackQuery.query.split(" ")[0],
              artist: trackQuery.artist,
              duration: "3:30",
              artworkUrl: "",
              previewUrl: "",
            };
          })
        );

        // Get seed track (first track)
        const seedTrack = tracks[0];

        return {
          id: playlist.id,
          title: playlist.title,
          description: playlist.description,
          seedTrack: seedTrack?.name || "",
          seedArtist: seedTrack?.artist || "",
          seedArtwork: seedTrack?.artworkUrl || "",
          curatorName: playlist.curatorName,
          trackCount: tracks.length,
          genres: playlist.genres,
          emotions: playlist.emotions,
          tracks,
        };
      })
    );

    return NextResponse.json({ playlists });
  } catch (error) {
    console.error("Error fetching discover playlists:", error);
    return NextResponse.json(
      { error: "Failed to fetch playlists" },
      { status: 500 }
    );
  }
}
