import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST /api/music-accounts - Store or update music account connection
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 401 });
    }

    const body = await request.json();
    const { provider, music_user_token, provider_user_id } = body;

    if (!provider || !music_user_token) {
      return NextResponse.json(
        { error: 'Provider and music_user_token are required' },
        { status: 400 }
      );
    }

    // Upsert the music account
    const { data, error } = await supabase
      .from('user_music_accounts')
      .upsert(
        {
          user_id: userId,
          provider,
          music_user_token,
          provider_user_id: provider_user_id || null,
          is_active: true,
          connected_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,provider',
        }
      )
      .select()
      .single();

    if (error) {
      console.error('Error storing music account:', error);
      return NextResponse.json({ error: 'Failed to store music account' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      account: {
        id: data.id,
        provider: data.provider,
        is_active: data.is_active,
        connected_at: data.connected_at,
      },
    });
  } catch (error) {
    console.error('Music accounts error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET /api/music-accounts - Get user's connected music accounts
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('user_music_accounts')
      .select('id, provider, is_active, connected_at, last_synced_at')
      .eq('user_id', userId);

    if (error) {
      console.error('Error fetching music accounts:', error);
      return NextResponse.json({ error: 'Failed to fetch music accounts' }, { status: 500 });
    }

    return NextResponse.json({ accounts: data || [] });
  } catch (error) {
    console.error('Music accounts error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/music-accounts - Disconnect a music account
export async function DELETE(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider');

    if (!provider) {
      return NextResponse.json({ error: 'Provider is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('user_music_accounts')
      .delete()
      .eq('user_id', userId)
      .eq('provider', provider);

    if (error) {
      console.error('Error deleting music account:', error);
      return NextResponse.json({ error: 'Failed to disconnect music account' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Music accounts error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
