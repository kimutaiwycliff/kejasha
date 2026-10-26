import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  // Hundreds of generated API pages; leave room on slow (emulated) builders.
  staticPageGenerationTimeout: 300,
  reactStrictMode: true,
};

export default withMDX(config);
