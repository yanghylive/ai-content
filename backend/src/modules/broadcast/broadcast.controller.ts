import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BroadcastService } from './broadcast.service';

@Controller('broadcast')
export class BroadcastController {
  constructor(private readonly service: BroadcastService) {}

  @Get('health')
  health() {
    return this.service.health();
  }

  @Get('jobs')
  list() {
    return this.service.list();
  }

  @Get('jobs/:id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('jobs')
  create(
    @Body()
    body: {
      name: string;
      storeName: string;
      sceneUrl: string;
      outputUrl?: string;
    },
  ) {
    return this.service.create(body);
  }

  @Post('jobs/:id/segments')
  addSegment(
    @Param('id') id: string,
    @Body() body: { text: string; voiceId?: string },
  ) {
    return this.service.addSegment(id, body);
  }

  @Post('jobs/:id/segments/:segmentId/synthesize')
  synthesize(@Param('id') id: string, @Param('segmentId') segmentId: string) {
    return this.service.synthesizeSegment(id, segmentId);
  }

  @Post('jobs/:id/start')
  start(@Param('id') id: string) {
    return this.service.start(id);
  }

  @Post('jobs/:id/pause')
  pause(@Param('id') id: string) {
    return this.service.transition(id, 'PAUSED');
  }

  @Post('jobs/:id/stop')
  stop(@Param('id') id: string) {
    return this.service.transition(id, 'ENDED');
  }
}
