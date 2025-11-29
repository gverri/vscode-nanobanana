import { GoogleGenAI } from '@google/genai';
import type { GeneratedImage, ImageConfig } from '../types';

export class GeminiService {
  private client: GoogleGenAI | null = null;

  initialize(apiKey: string): void {
    this.client = new GoogleGenAI({ apiKey });
  }

  isInitialized(): boolean {
    return this.client !== null;
  }

  async generateDiagram(
    diagramTypePrompt: string,
    userContent: string,
    config: ImageConfig = {}
  ): Promise<GeneratedImage> {
    if (!this.client) {
      throw new Error('Gemini API not initialized. Please set your API key.');
    }

    const finalPrompt = `${diagramTypePrompt} showing: ${userContent}`;

    try {
      const response = await this.client.models.generateContent({
        model: config.model || 'gemini-3-pro-image-preview',
        contents: finalPrompt,
        config: {
          responseModalities: ['image', 'text'],
        },
      });

      const parts = response.candidates?.[0]?.content?.parts;
      if (!parts || parts.length === 0) {
        throw new Error('No response from model. Please try a different prompt.');
      }

      for (const part of parts) {
        if (part.inlineData) {
          return {
            base64: part.inlineData.data as string,
            mimeType: part.inlineData.mimeType || 'image/png',
          };
        }
      }

      throw new Error('No image was generated. Please try a different prompt.');
    } catch (error) {
      console.error('[NanoBanana] Gemini API error:', error);
      if (error instanceof Error) {
        console.error('[NanoBanana] Error message:', error.message);
        console.error('[NanoBanana] Error stack:', error.stack);
        if (error.message.includes('API key')) {
          throw new Error('Invalid API key. Please check your Gemini API key.');
        }
        if (error.message.includes('quota') || error.message.includes('rate')) {
          throw new Error('API rate limit exceeded. Please try again later.');
        }
        throw error;
      }
      throw new Error('An unexpected error occurred during image generation.');
    }
  }
}
