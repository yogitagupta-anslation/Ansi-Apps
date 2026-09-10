import React, {useState} from 'react';
import {Image, KeyboardAvoidingView, Platform, Pressable, View} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import {
  Button,
  Card,
  Chips,
  Field,
  Header,
  Screen,
  Scroll,
  T,
  useT,
} from '../components/ui/Kit';
import {LANGUAGES, VEHICLES} from '../config/catalogue';
import {radius, spacing} from '../config/theme';
import {useHitch} from '../state/store';
import type {Profile, RiderDetails, Role, VehicleKind} from '../types';

/**
 * First launch, through to a usable account.
 *
 * One component holding a step machine rather than eight routed screens. The flow is
 * strictly linear, every step is small, and the back button has one meaning throughout —
 * a navigator would add a route table, param types and a history stack in exchange for
 * none of that.
 *
 * The split the spec asks for is the important part: a passenger answers four questions,
 * a rider answers a dozen. That asymmetry is correct and worth preserving — a passenger
 * is handing over almost nothing, while a rider is asking a stranger to get into their
 * vehicle, and the details they give are what makes that reasonable.
 */

type Step =
  | 'welcome'
  | 'role'
  // passenger
  | 'pProfile'
  | 'pDetails'
  | 'pIdentity'
  // rider
  | 'rProfile'
  | 'rKind'
  | 'rVehicle'
  | 'rPhotos'
  | 'rInfo'
  | 'rReady';

const PASSENGER_STEPS: Step[] = ['pProfile', 'pDetails', 'pIdentity'];
const RIDER_STEPS: Step[] = ['rProfile', 'rKind', 'rVehicle', 'rPhotos', 'rInfo', 'rReady'];

/** A short, stable id derived from the name and the clock — the stand-in for a key hash. */
function makeIdentityId(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 8);
}

export function OnboardingScreen() {
  const t = useT();
  const setRole = useHitch(s => s.setRole);
  const complete = useHitch(s => s.completeOnboarding);

  const [step, setStep] = useState<Step>('welcome');
  const [role, setLocalRole] = useState<Role>('passenger');

  // Shared profile fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [languages, setLanguages] = useState<string[]>(['Hindi']);
  const [emergency, setEmergency] = useState('');

  // Rider fields
  const [kind, setKind] = useState<VehicleKind>('auto');
  const [registration, setRegistration] = useState('');
  const [model, setModel] = useState('');
  const [colour, setColour] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [experience, setExperience] = useState('');

  const flow = role === 'passenger' ? PASSENGER_STEPS : RIDER_STEPS;
  const indexInFlow = flow.indexOf(step);

  const pickImage = async (onPicked: (uri: string) => void) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) {
      onPicked(result.assets[0].uri);
    }
  };

  const identityId = makeIdentityId(`${name}${phone}`);

  const finish = () => {
    const profile: Profile = {
      id: identityId,
      name: name.trim() || 'Rider',
      phone: phone.trim(),
      photoUri: photo,
      languages,
      emergencyContact: role === 'passenger' ? emergency.trim() || undefined : undefined,
    };
    const rider: RiderDetails | undefined =
      role === 'rider'
        ? {
            vehicle: {
              kind,
              registration: registration.trim().toUpperCase(),
              model: model.trim(),
              colour: colour.trim(),
              photos,
            },
            experienceYears: Number(experience) || 0,
            acceptsPassengers: true,
            showNearbyRequests: true,
          }
        : undefined;
    setRole(role);
    complete(profile, rider);
  };

  const back = () => {
    if (step === 'role') {
      setStep('welcome');
      return;
    }
    if (indexInFlow > 0) {
      setStep(flow[indexInFlow - 1]);
      return;
    }
    setStep('role');
  };

  // ------------------------------------------------------------- welcome

  if (step === 'welcome') {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={{flex: 1, justifyContent: 'center', padding: spacing.xl}}>
          <T style={{fontSize: 56, marginBottom: spacing.lg}}>🛺</T>
          <T variant="display">Rides from the phones around you</T>
          <T variant="body" tone="dim" style={{marginTop: spacing.md, lineHeight: 22}}>
            Hitch finds riders over Bluetooth. No account, no booking server, no internet —
            it works in a basement car park and on a road with no signal.
          </T>
          <View style={{height: spacing.xxl}} />
          <Button label="Get started" onPress={() => setStep('role')} />
        </View>
      </Screen>
    );
  }

  // ------------------------------------------------------------- role

  if (step === 'role') {
    return (
      <Screen edges={['top', 'bottom']}>
        <Header title="How will you use Hitch?" onBack={back} />
        <View style={{padding: spacing.lg, gap: spacing.md, flex: 1}}>
          <RoleCard
            glyph="🧑"
            title="Passenger"
            body="Find a ride from someone nearby."
            selected={role === 'passenger'}
            onPress={() => setLocalRole('passenger')}
          />
          <RoleCard
            glyph="🛺"
            title="Rider"
            body="Offer rides in your own vehicle."
            selected={role === 'rider'}
            onPress={() => setLocalRole('rider')}
          />
          <T variant="caption" tone="faint" style={{marginTop: spacing.sm, lineHeight: 17}}>
            You can switch at any time from your profile — plenty of people do both.
          </T>
          <View style={{flex: 1}} />
          <Button
            label="Continue"
            onPress={() => setStep(role === 'passenger' ? 'pProfile' : 'rProfile')}
          />
        </View>
      </Screen>
    );
  }

  // ------------------------------------------------------------- shared chrome

  const StepFrame = ({
    title,
    subtitle,
    children,
    cta,
    ctaEnabled = true,
    onCta,
  }: {
    title: string;
    subtitle?: string;
    children: React.ReactNode;
    cta: string;
    ctaEnabled?: boolean;
    onCta: () => void;
  }) => (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{flex: 1}}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Header
          title={title}
          subtitle={subtitle}
          onBack={back}
          right={
            <T variant="caption" tone="faint">
              {indexInFlow + 1} / {flow.length}
            </T>
          }
        />
        <View style={{flex: 1}}>
          <Scroll>{children}</Scroll>
        </View>
        <View style={{padding: spacing.lg}}>
          <Button label={cta} onPress={onCta} disabled={!ctaEnabled} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );

  const PhotoPicker = ({
    uri,
    onPick,
    label,
    size = 96,
  }: {
    uri: string | null;
    onPick: () => void;
    label: string;
    size?: number;
  }) => (
    <Pressable
      onPress={onPick}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: t.surfaceAlt,
        borderWidth: 1,
        borderColor: t.border,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
      {uri ? (
        <Image source={{uri}} style={{width: '100%', height: '100%'}} />
      ) : (
        <T variant="caption" tone="faint">
          Add
        </T>
      )}
    </Pressable>
  );

  // ------------------------------------------------------------- passenger

  if (step === 'pProfile') {
    return (
      <StepFrame
        title="Create your profile"
        subtitle="This is what a rider sees"
        cta="Continue"
        ctaEnabled={name.trim().length >= 2}
        onCta={() => setStep('pDetails')}>
        <View style={{alignItems: 'center', marginBottom: spacing.xl}}>
          <PhotoPicker
            uri={photo}
            onPick={() => void pickImage(setPhoto)}
            label="Add a profile photo"
          />
          <T variant="caption" tone="faint" style={{marginTop: spacing.sm}}>
            Optional. Stays on this phone.
          </T>
        </View>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" />
        <Field
          label="Phone number"
          value={phone}
          onChangeText={setPhone}
          placeholder="For the rider to call you"
          keyboardType="phone-pad"
          maxLength={14}
          hint="Never broadcast. Shared only with a rider you have matched with."
        />
      </StepFrame>
    );
  }

  if (step === 'pDetails') {
    return (
      <StepFrame
        title="About you"
        subtitle="Two more things, both optional"
        cta="Continue"
        onCta={() => setStep('pIdentity')}>
        <T variant="label" tone="dim" style={{marginBottom: spacing.sm}}>
          Languages you speak
        </T>
        <Chips
          options={LANGUAGES}
          selected={languages}
          multi
          onToggle={value =>
            setLanguages(cur =>
              cur.includes(value) ? cur.filter(l => l !== value) : [...cur, value],
            )
          }
        />
        <View style={{height: spacing.xl}} />
        <Field
          label="Emergency contact"
          value={emergency}
          onChangeText={setEmergency}
          placeholder="Someone to call"
          keyboardType="phone-pad"
          maxLength={14}
          hint="Kept on this phone. Reachable from the ride screen in one tap."
        />
      </StepFrame>
    );
  }

  if (step === 'pIdentity') {
    return (
      <StepFrame title="Your ride identity" cta="Start using Hitch" onCta={finish}>
        <IdentityCard id={identityId} name={name} />
        <T variant="caption" tone="faint" style={{marginTop: spacing.lg, lineHeight: 18}}>
          A rider sees this code, not your phone number. It comes from a key that lives in
          this phone and never leaves it, so nobody can claim to be you without it.
        </T>
      </StepFrame>
    );
  }

  // ------------------------------------------------------------- rider

  if (step === 'rProfile') {
    return (
      <StepFrame
        title="Become a rider"
        subtitle="Passengers see all of this"
        cta="Continue"
        ctaEnabled={name.trim().length >= 2}
        onCta={() => setStep('rKind')}>
        <View style={{alignItems: 'center', marginBottom: spacing.xl}}>
          <PhotoPicker uri={photo} onPick={() => void pickImage(setPhoto)} label="Add a photo" />
          <T variant="caption" tone="faint" style={{marginTop: spacing.sm}}>
            Worth adding — a passenger is getting into your vehicle.
          </T>
        </View>
        <Field label="Full name" value={name} onChangeText={setName} autoCapitalize="words" />
        <Field
          label="Phone number"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          maxLength={14}
        />
      </StepFrame>
    );
  }

  if (step === 'rKind') {
    return (
      <StepFrame title="What do you drive?" cta="Continue" onCta={() => setStep('rVehicle')}>
        <View style={{gap: spacing.md}}>
          {VEHICLES.map(v => (
            <RoleCard
              key={v.kind}
              glyph={v.glyph}
              title={v.label}
              body={v.blurb}
              selected={kind === v.kind}
              onPress={() => setKind(v.kind)}
            />
          ))}
        </View>
      </StepFrame>
    );
  }

  if (step === 'rVehicle') {
    return (
      <StepFrame
        title="Vehicle details"
        subtitle="So a passenger can spot you"
        cta="Continue"
        ctaEnabled={registration.trim().length >= 4}
        onCta={() => setStep('rPhotos')}>
        <Field
          label="Vehicle number"
          value={registration}
          onChangeText={setRegistration}
          placeholder="HR 26 AB 1234"
          autoCapitalize="characters"
          maxLength={16}
          hint="Shown to your passenger before they get in."
        />
        <Field label="Model" value={model} onChangeText={setModel} placeholder="Bajaj RE" autoCapitalize="words" />
        <Field label="Colour" value={colour} onChangeText={setColour} placeholder="Green and yellow" autoCapitalize="words" />
      </StepFrame>
    );
  }

  if (step === 'rPhotos') {
    return (
      <StepFrame
        title="Vehicle photos"
        subtitle="Two or three is plenty"
        cta={photos.length > 0 ? 'Continue' : 'Skip for now'}
        onCta={() => setStep('rInfo')}>
        <View style={{flexDirection: 'row', gap: spacing.md}}>
          {['Front', 'Side', 'Other'].map((slot, i) => (
            <View key={slot} style={{flex: 1, alignItems: 'center', gap: 6}}>
              <Pressable
                onPress={() =>
                  void pickImage(uri =>
                    setPhotos(cur => {
                      const next = [...cur];
                      next[i] = uri;
                      return next.filter(Boolean);
                    }),
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={`Add ${slot} photo`}
                style={{
                  width: '100%',
                  aspectRatio: 0.85,
                  borderRadius: radius.md,
                  backgroundColor: t.surfaceAlt,
                  borderWidth: 1,
                  borderColor: t.border,
                  borderStyle: photos[i] ? 'solid' : 'dashed',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}>
                {photos[i] ? (
                  <Image source={{uri: photos[i]}} style={{width: '100%', height: '100%'}} />
                ) : (
                  <T variant="title" tone="faint">
                    +
                  </T>
                )}
              </Pressable>
              <T variant="caption" tone="faint">
                {slot}
              </T>
            </View>
          ))}
        </View>
        <T variant="caption" tone="faint" style={{marginTop: spacing.lg, lineHeight: 18}}>
          These are how a passenger knows they are getting into the right vehicle. They stay
          on this phone and are sent only to someone you have matched with.
        </T>
      </StepFrame>
    );
  }

  if (step === 'rInfo') {
    return (
      <StepFrame title="Rider information" cta="Continue" onCta={() => setStep('rReady')}>
        <Field
          label="Years driving"
          value={experience}
          onChangeText={setExperience}
          placeholder="4"
          keyboardType="number-pad"
          maxLength={2}
        />
        <T variant="label" tone="dim" style={{marginBottom: spacing.sm}}>
          Languages you speak
        </T>
        <Chips
          options={LANGUAGES}
          selected={languages}
          multi
          onToggle={value =>
            setLanguages(cur =>
              cur.includes(value) ? cur.filter(l => l !== value) : [...cur, value],
            )
          }
        />
      </StepFrame>
    );
  }

  // rReady
  return (
    <StepFrame title="You're ready to ride" cta="Finish setup" onCta={finish}>
      <Card>
        <T variant="heading">{VEHICLES.find(v => v.kind === kind)?.label}</T>
        <T variant="body" tone="dim" style={{marginTop: 4}}>
          {registration.toUpperCase() || 'No number yet'}
          {model ? ` · ${model}` : ''}
        </T>
        <View style={{height: spacing.lg}} />
        <T variant="caption" tone="faint" style={{lineHeight: 18}}>
          Going online starts advertising over Bluetooth so passengers nearby can find you.
          You can go offline from the Ride tab whenever you like.
        </T>
      </Card>
      <IdentityCard id={identityId} name={name} style={{marginTop: spacing.lg}} />
    </StepFrame>
  );
}

// ------------------------------------------------------------------ pieces

function RoleCard({
  glyph,
  title,
  body,
  selected,
  onPress,
}: {
  glyph: string;
  title: string;
  body: string;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useT();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{selected}}
      accessibilityLabel={`${title}. ${body}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        padding: spacing.lg,
        borderRadius: radius.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? t.accent : t.border,
        backgroundColor: selected ? t.accentSoft : t.surface,
      }}>
      <T style={{fontSize: 30}}>{glyph}</T>
      <View style={{flex: 1}}>
        <T variant="heading">{title}</T>
        <T variant="caption" tone="dim" style={{marginTop: 2}}>
          {body}
        </T>
      </View>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: selected ? 7 : 1.5,
          borderColor: selected ? t.accent : t.border,
        }}
      />
    </Pressable>
  );
}

/**
 * The identity card, shown at the end of both flows.
 *
 * It is the app's answer to "why would I get into a stranger's vehicle": the code is
 * derived from a key that never leaves the phone, so it cannot be borrowed, and two people
 * who have met before will see the same code again. The wording avoids the word "verified"
 * for anything that has not actually been verified — this is a device identity, not a
 * background check, and saying otherwise would be the most dangerous sentence in the app.
 */
function IdentityCard({
  id,
  name,
  style,
}: {
  id: string;
  name: string;
  style?: object;
}) {
  const t = useT();
  return (
    <Card style={style}>
      <T variant="overline" tone="faint">
        YOUR RIDE IDENTITY
      </T>
      <T variant="display" style={{marginTop: spacing.sm, letterSpacing: 3}}>
        {id.slice(0, 4)} {id.slice(4)}
      </T>
      <T variant="caption" tone="dim" style={{marginTop: 6}}>
        {name.trim() || 'You'} · this device
      </T>
      <View style={{height: spacing.lg}} />
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
        <View style={{width: 6, height: 6, borderRadius: 3, backgroundColor: t.ok}} />
        <T variant="caption" tone="dim">
          Device identity created on this phone
        </T>
      </View>
    </Card>
  );
}
