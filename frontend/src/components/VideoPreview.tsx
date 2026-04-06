import { useState } from 'react';
import ReactPlayer from 'react-player';

interface Props {
    url: string;
    onChange: (url: string) => void;
}

export default function VideoPreview({ url, onChange }: Props) {
    const [inputValue, setInputValue] = useState(url);
    const [confirmed, setConfirmed] = useState(!!url);
    const isValid = ReactPlayer.canPlay(inputValue);

    const handleConfirm = () => {
        onChange(inputValue);
        setConfirmed(true);
    };

    return (
        <div className="space-y-3">
            <div className="flex gap-2">
                <input
                    type="url"
                    className="input h-12 flex-1"
                    placeholder="Paste a YouTube, Vimeo, or direct video URL..."
                    value={inputValue}
                    onChange={(e) => {
                        setInputValue(e.target.value);
                        setConfirmed(false);
                        if (!e.target.value) onChange('');
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
                />
                <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={!inputValue || !isValid}
                    className="px-4 h-12 rounded-xl bg-primary text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Preview
                </button>
            </div>

            {inputValue && !isValid && (
                <p className="text-xs text-destructive">
                    This URL doesn't look like a supported video (YouTube, Vimeo, Twitch, SoundCloud, or direct .mp4/.webm).
                </p>
            )}

            {confirmed && isValid && (
                <div className="rounded-xl overflow-hidden border border-border bg-black aspect-video">
                    <ReactPlayer
                        url={inputValue}
                        width="100%"
                        height="100%"
                        controls
                        light
                        onReady={() => onChange(inputValue)}
                    />
                </div>
            )}

            {!confirmed && !inputValue && (
                <div className="rounded-xl border-2 border-dashed border-border bg-secondary/20 aspect-video flex items-center justify-center">
                    <div className="text-center text-muted-foreground">
                        <div className="text-4xl mb-3">🎬</div>
                        <p className="text-sm font-medium">Paste a video URL above to preview</p>
                        <p className="text-xs mt-1">Supports YouTube, Vimeo, Twitch, or direct video files</p>
                    </div>
                </div>
            )}
        </div>
    );
}
