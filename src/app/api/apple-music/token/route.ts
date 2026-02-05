import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

// GET /api/apple-music/token - Get Apple Music developer token
export async function GET(request: NextRequest) {
  try {
    const token = generateAppleMusicToken();
    
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

function generateAppleMusicToken(): string | null {
  const privateKey = process.env.APPLE_MUSIC_PRIVATE_KEY;
  const teamId = process.env.APPLE_MUSIC_TEAM_ID;
  const keyId = process.env.APPLE_MUSIC_KEY_ID;

  if (!privateKey || !teamId || !keyId) {
    console.error('Missing Apple Music credentials');
    return null;
  }

  // Format the private key properly (handle escaped newlines)
  const formattedKey = privateKey.replace(/\\n/g, '\n');

  try {
    const token = jwt.sign({}, formattedKey, {
      algorithm: 'ES256',
      expiresIn: '180d', // 6 months max
      issuer: teamId,
      header: {
        alg: 'ES256',
        kid: keyId,
      },
    });

    return token;
  } catch (error) {
    console.error('Error generating Apple Music token:', error);
    return null;
  }
}
