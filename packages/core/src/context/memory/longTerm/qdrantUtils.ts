/**
 * Utility functions for Qdrant client configuration
 */

/**
 * Extracts the port from a Qdrant URL.
 * If the URL explicitly includes a port, it uses that port.
 * Otherwise, defaults to 443 for https:// and 6333 for http://.
 * 
 * @param url - The Qdrant URL (e.g., "http://localhost:6333" or "https://qdrant")
 * @returns The port number
 * 
 * @example
 * getPortFromUrl("http://localhost:6333") // Returns 6333
 * getPortFromUrl("https://qdrant") // Returns 443
 * getPortFromUrl("http://localhost") // Returns 6333
 */
export function getPortFromUrl(url: string): number {
  try {
    const urlObj = new URL(url);
    
    // If port is explicitly specified in the URL, use it
    if (urlObj.port) {
      return parseInt(urlObj.port, 10);
    }
    
    // Default ports based on protocol
    if (urlObj.protocol === 'https:') {
      return 443;
    }
    
    // Default to 6333 for http or if protocol is unclear
    return 6333;
  } catch (error) {
    // If URL parsing fails, assume http://localhost:6333
    console.warn(`Failed to parse Qdrant URL: ${url}, defaulting to port 6333`);
    return 6333;
  }
}

/**
 * Creates a QdrantClient configuration object with proper port handling.
 * 
 * @param url - The Qdrant URL
 * @param apiKey - The optional API key
 * @returns Configuration object for QdrantClient
 */
export function createQdrantConfig(url: string, apiKey?: string) {
  return {
    url,
    port: getPortFromUrl(url),
    apiKey,
  };
}
