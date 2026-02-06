import { NextRequest, NextResponse } from 'next/server';
import * as jose from 'jose';

// GET /api/apple-music/token - Get Apple Music developer token
export async function GET(request: NextRequest) {
  try {
    const token = await generateAppleMusicToken();
    
    if (!token) {
      return NextResponse.json(
        { error: 'Failed to generate token. Check Apple Music credentials.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ token });
  } catch (error) {
    console.error('Apple Music token error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function generateAppleMusicToken(): Promise<string | null> {
  let privateKey = process.env.APPLE_MUSIC_PRIVATE_KEY;
  const teamId = process.env.APPLE_MUSIC_TEAM_ID;
  const keyId = process.env.APPLE_MUSIC_KEY_ID;

  if (!privateKey || !teamId || !keyId) {
    console.error('Missing Apple Music credentials');
    return null;
  }

  // Handle different private key formats from environment variables
  // Vercel might store with literal \n or actual newlines
  if (privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }
  
  // Ensure proper PEM format
  if (!privateKey.includes('-----BEGIN')) {
    privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
  }

  try {
    // Parse the private key using jose
    const key = await jose.importPKCS8(privateKey, 'ES256');
    
    // Create JWT token
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 15777000; // ~6 months in seconds
    
    const token = await new jose.SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: keyId })
      .setIssuer(teamId)
      .setIssuedAt(now)
      .setExpirationTime(now + expiresIn)
      .sign(key);

    return token;
  } catch (error) {
    console.error('Error generating Apple Music token:', error);
    return null;
  }
}
