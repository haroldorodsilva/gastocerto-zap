import { Test } from '@nestjs/testing';
import { OnboardingStateService } from '../../../src/features/onboarding/onboarding-state.service';
import { PrismaService } from '../../../src/core/database/prisma.service';
import { EmailValidator } from '../../../src/features/onboarding/validators/email.validator';
import { NameValidator } from '../../../src/features/onboarding/validators/name.validator';
import { PhoneValidator } from '../../../src/features/onboarding/validators/phone.validator';

describe('OnboardingStateService - Bug platformId', () => {
  let service: OnboardingStateService;
  let prisma: any;

  beforeEach(async () => {
    const mockPrisma: any = {
      onboardingSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({ id: 1, platformId: '707624962', completed: true }),
        upsert: jest.fn().mockResolvedValue({ id: 1, platformId: '707624962', phoneNumber: null }),
      },
    };

    const mockEmailValidator: any = {
      validate: jest.fn().mockResolvedValue({ valid: true }),
    };

    const mockNameValidator: any = {
      validate: jest.fn().mockResolvedValue({ valid: true }),
    };

    const mockPhoneValidator: any = {
      validate: jest.fn().mockResolvedValue({ valid: true }),
    };

    const module = await Test.createTestingModule({
      providers: [
        OnboardingStateService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailValidator, useValue: mockEmailValidator },
        { provide: NameValidator, useValue: mockNameValidator },
        { provide: PhoneValidator, useValue: mockPhoneValidator },
      ],
    }).compile();

    service = module.get<OnboardingStateService>(OnboardingStateService);
    prisma = module.get(PrismaService);
  });

  it('completeOnboarding deve usar platformId, não phoneNumber', async () => {
    await service.completeOnboarding('707624962');
    
    const [[params]] = (prisma.onboardingSession.updateMany as jest.Mock).mock.calls;
    
    expect(params.where.platformId).toBe('707624962');
    expect(params.where).not.toHaveProperty('phoneNumber');
  });

  it('getActiveSession deve usar platformId', async () => {
    await service.getActiveSession('707624962');
    
    const [[params]] = (prisma.onboardingSession.findFirst as jest.Mock).mock.calls;
    
    expect(params.where.platformId).toBe('707624962');
  });

  it('startOnboarding deve criar com platformId e phoneNumber null', async () => {
    // Mock getActiveSession to return null (no existing session)
    (prisma.onboardingSession.findFirst as jest.Mock).mockResolvedValueOnce(null);
    
    await service.startOnboarding('707624962', 'telegram');
    
    // Get the first call to upsert
    const calls = (prisma.onboardingSession.upsert as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    
    const [params] = calls[0];
    
    expect(params.create.platformId).toBe('707624962');
    expect(params.create.phoneNumber).toBeNull();
  });
});
