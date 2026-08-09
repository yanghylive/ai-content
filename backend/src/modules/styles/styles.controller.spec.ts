import { Test, TestingModule } from '@nestjs/testing';
import { StylesController } from './styles.controller';
import { StylesService } from './styles.service';

describe('StylesController', () => {
  let controller: StylesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StylesController],
      providers: [
        {
          provide: StylesService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<StylesController>(StylesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
