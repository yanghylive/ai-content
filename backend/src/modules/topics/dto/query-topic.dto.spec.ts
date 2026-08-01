import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { QueryTopicDto } from './query-topic.dto';

describe('QueryTopicDto', () => {
  const toDto = (query: Record<string, unknown>) =>
    plainToInstance(QueryTopicDto, query, {
      enableImplicitConversion: true,
    });

  it('should preserve false string for isPublished filter', () => {
    const dto = toDto({ isPublished: 'false' });

    expect(validateSync(dto)).toEqual([]);
    expect(dto.isPublished).toBe(false);
  });

  it('should preserve true string for isPublished filter', () => {
    const dto = toDto({ isPublished: 'true' });

    expect(validateSync(dto)).toEqual([]);
    expect(dto.isPublished).toBe(true);
  });
});
