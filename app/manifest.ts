import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'myHealthyAgent',
    short_name: 'HealthLog',
    description: 'Track symptoms in 7 seconds',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#3b82f6',
    orientation: 'portrait',
    icons: [
      {
        src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="%233b82f6" rx="24"/><text x="96" y="120" font-size="80" fill="white" text-anchor="middle">H</text></svg>',
        sizes: '192x192',
        type: 'image/svg+xml',
      },
      {
        src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="%233b82f6" rx="64"/><text x="256" y="320" font-size="200" fill="white" text-anchor="middle">H</text></svg>',
        sizes: '512x512',
        type: 'image/svg+xml',
      },
    ],
  };
}
