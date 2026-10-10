import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createBridgeClient} from './bridge-client.mjs';
import {createLinkMcpServer} from './mcp-server.mjs';
const connectionIndex=process.argv.indexOf('--connection');
if(connectionIndex>=0 && !process.argv[connectionIndex+1])throw new Error('--connection requires a file path.');
const server=createLinkMcpServer({call:createBridgeClient(connectionIndex>=0?process.argv[connectionIndex+1]:undefined),htmlPath:new URL('./widget.html',import.meta.url)});
await server.connect(new StdioServerTransport());
