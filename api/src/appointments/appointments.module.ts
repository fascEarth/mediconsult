import { Body, Controller, Get, HttpCode, Module, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/common.module';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { DoctorsModule } from '../doctors/doctors.module';
import { AppointmentsService } from './appointments.service';
import { ChatGateway, MessagesService } from './chat.gateway';

const BookDto = z.object({
  doctorId: z.string().min(1),
  startsAt: z.string().datetime(),
  reason: z.string().trim().min(3).max(1000),
  consent: z.literal(true, { errorMap: () => ({ message: 'Consent is required' }) }),
  recordIds: z.array(z.string()).max(10).optional(),
});
const ConfirmDto = z.object({ orderId: z.string().min(1), paymentId: z.string().min(1), signature: z.string().optional() });
const CancelDto = z.object({ reason: z.string().max(500).optional() });
const text = z.string().max(5000).optional();
const NotesDto = z.object({ subjective: text, objective: text, assessment: text, plan: text });
const PrescriptionDto = z.object({
  diagnosis: z.string().trim().min(2).max(500),
  items: z.array(z.object({
    medicine: z.string().trim().min(1).max(200), dosage: z.string().trim().min(1).max(100),
    frequency: z.string().trim().min(1).max(100), duration: z.string().trim().min(1).max(100), instructions: z.string().max(300).optional(),
  })).max(30),
  advice: z.string().max(3000).optional(),
  followUpDays: z.number().int().min(0).max(365).optional(),
});
const ReviewDto = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().max(1000).optional() });
const MessageDto = z.object({ body: z.string().trim().min(1).max(4000) });

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appts: AppointmentsService, private readonly messages: MessagesService) {}

  @Roles('PATIENT') @Post()
  book(@CurrentUser() u: AuthUser, @Body(new ZodPipe(BookDto)) body: z.infer<typeof BookDto>) {
    return this.appts.book(u, body);
  }

  @Get()
  mine(@CurrentUser() u: AuthUser, @Query('scope') scope?: string) {
    return this.appts.mine(u, scope === 'past' ? 'past' : 'upcoming');
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.appts.get(u, id);
  }

  @Roles('PATIENT') @Post(':id/payment')
  pay(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.appts.createPayment(u, id);
  }

  @Roles('PATIENT') @HttpCode(200) @Post(':id/payment/confirm')
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(ConfirmDto)) body: z.infer<typeof ConfirmDto>) {
    return this.appts.confirmPayment(u, id, body);
  }

  @Roles('PATIENT', 'DOCTOR') @HttpCode(200) @Post(':id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(CancelDto)) body: z.infer<typeof CancelDto>) {
    return this.appts.cancel(u, id, body.reason);
  }

  @Roles('PATIENT', 'DOCTOR') @Post(':id/join')
  join(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.appts.join(u, id);
  }

  @Roles('DOCTOR') @Get(':id/notes')
  notes(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.appts.getNotes(u, id);
  }

  @Roles('DOCTOR') @Put(':id/notes')
  saveNotes(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(NotesDto)) body: z.infer<typeof NotesDto>) {
    return this.appts.saveNotes(u, id, body);
  }

  @Roles('PATIENT', 'DOCTOR') @Get(':id/prescription')
  prescription(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.appts.getPrescription(u, id);
  }

  @Roles('DOCTOR') @Put(':id/prescription')
  savePrescription(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(PrescriptionDto)) body: z.infer<typeof PrescriptionDto>) {
    return this.appts.savePrescription(u, id, body);
  }

  @Roles('DOCTOR') @HttpCode(200) @Post(':id/complete')
  complete(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.appts.complete(u, id);
  }

  @Roles('DOCTOR') @HttpCode(200) @Post(':id/no-show')
  noShow(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.appts.noShow(u, id);
  }

  @Roles('PATIENT') @Post(':id/review')
  review(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(ReviewDto)) body: z.infer<typeof ReviewDto>) {
    return this.appts.review(u, id, body.rating, body.comment);
  }

  @Roles('PATIENT', 'DOCTOR') @Get(':id/messages')
  listMessages(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.messages.list(u, id);
  }

  @Roles('PATIENT', 'DOCTOR') @Post(':id/messages')
  send(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(MessageDto)) body: z.infer<typeof MessageDto>) {
    return this.messages.send(u, id, body.body);
  }
}

@Module({
  imports: [DoctorsModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, MessagesService, ChatGateway],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
