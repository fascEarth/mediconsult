import { Component, computed, input } from '@angular/core';

const DOCS: Record<string, { title: string; body: string[] }> = {
  telemedicine: {
    title: 'Telemedicine consent (v2026-11-v1)',
    body: [
      'I understand that a teleconsultation is a remote consultation by video, audio or chat with a registered medical practitioner and is not a substitute for an in-person examination when one is needed.',
      'The doctor may decide that my condition needs an in-person visit or emergency care and may decline to prescribe certain medicines remotely.',
      'I will give accurate information about my health. I understand the doctor relies on what I share.',
      'Consultations are not recorded. Notes, prescriptions, chat and reports are stored encrypted and shared only with the treating doctor and me.',
      'This service is not for emergencies. In an emergency I will call local emergency services (112 in India).',
      'I can withdraw this consent at any time by not proceeding with or by cancelling the consultation.',
    ],
  },
  privacy: {
    title: 'Privacy policy (summary)',
    body: [
      'We collect only what we need to provide consultations: identity and contact details, appointment details, information you choose to share with a doctor, and payment confirmations (we never store card details).',
      'Health information (notes, prescriptions, chat, uploaded reports, medical summary) is encrypted at rest with AES-256-GCM. Access is restricted to you and your treating doctor and every access is logged.',
      'We do not sell your data or use it for advertising.',
      'You can download your data or request deletion from your Health profile. Clinical records are retained for the period required by applicable medical record laws.',
      'We follow principles of India’s Digital Personal Data Protection Act 2023, the Telemedicine Practice Guidelines 2020, GDPR and HIPAA-style safeguards where applicable. This summary is a template and must be reviewed by your legal counsel before production use.',
    ],
  },
  terms: {
    title: 'Terms of use (summary)',
    body: [
      'MediConsult is a platform connecting patients with independent registered medical practitioners. Medical advice is the responsibility of the treating doctor.',
      'Free cancellation up to 2 hours before a confirmed consultation. Doctors may cancel with a full refund to you.',
      'Do not use the service for emergencies, for obtaining controlled substances, or to share false information.',
      'This text is a template for demonstration and must be reviewed by legal counsel before production use.',
    ],
  },
};

@Component({
  template: `
    <div class="page narrow">
      <article class="card pad legal">
        <h1>{{ doc().title }}</h1>
        @for (p of doc().body; track $index) {<p>{{ p }}</p>}
      </article>
    </div>
  `,
})
export default class LegalPage {
  readonly docName = input<string>('privacy', { alias: 'doc' });
  doc = computed(() => DOCS[this.docName()] ?? DOCS['privacy']);
}
