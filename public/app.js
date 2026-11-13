const slotsElement = document.querySelector('#slots');
const currentDateElement = document.querySelector('#current-date');
const bookingMessage = document.querySelector('#booking-message');
const feedingState = document.querySelector('#feeding-state');
const feedingForm = document.querySelector('#feeding-form');
const feedingMessage = document.querySelector('#feeding-message');

function showMessage(element, text, type) {
  element.textContent = text;
  element.className = `notice notice--${type}`;
  element.hidden = false;
}

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Не удалось выполнить действие.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function postJson(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function formatDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date(year, month - 1, day));
}

function formatTime(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function createSlot(slot) {
  const article = document.createElement('article');
  article.className = `slot slot--${slot.bookedBy ? 'booked' : 'free'}`;

  const header = document.createElement('div');
  header.className = 'slot__header';
  const time = document.createElement('time');
  time.className = 'slot__time';
  time.textContent = slot.slotTime;
  const status = document.createElement('span');
  status.className = 'slot__status';
  status.textContent = slot.bookedBy ? 'Занято' : 'Свободно';
  header.append(time, status);
  article.append(header);

  if (slot.bookedBy) {
    const caption = document.createElement('p');
    caption.className = 'slot__caption';
    caption.textContent = 'Записан на прогулку';
    const name = document.createElement('p');
    name.className = 'slot__name';
    name.textContent = slot.bookedBy;
    article.append(caption, name);
    return article;
  }

  const form = document.createElement('form');
  const field = document.createElement('div');
  const label = document.createElement('label');
  const inputId = `walk-${slot.slotTime.replace(':', '-')}`;
  label.className = 'field-label';
  label.htmlFor = inputId;
  label.textContent = 'ФИО сотрудника';
  const input = document.createElement('input');
  input.id = inputId;
  input.name = 'employeeName';
  input.type = 'text';
  input.placeholder = 'Анна Тестова';
  input.autocomplete = 'off';
  input.required = true;
  field.append(label, input);

  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'Записаться';
  form.className = 'slot-form';
  form.append(field, button);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    input.disabled = true;
    button.disabled = true;
    try {
      const state = await postJson('/api/bookings', {
        slotTime: slot.slotTime,
        employeeName: input.value
      });
      renderState(state);
      showMessage(bookingMessage, `Запись на ${slot.slotTime} подтверждена.`, 'success');
    } catch (error) {
      if (error.status === 409) {
        await loadState();
      }
      showMessage(bookingMessage, error.message, 'error');
      input.disabled = false;
      button.disabled = false;
    }
  });

  article.append(form);
  return article;
}

function renderFeeding(feeding) {
  feedingState.replaceChildren();
  if (!feeding) {
    const empty = document.createElement('p');
    empty.className = 'feeding-empty';
    empty.textContent = 'Отметок пока нет. Если вы покормили Бориса, оставьте первую отметку.';
    feedingState.append(empty);
    return;
  }

  const label = document.createElement('p');
  label.className = 'feeding-state__label';
  label.textContent = 'Последняя отметка';
  const time = document.createElement('p');
  time.className = 'feeding-state__time';
  time.textContent = formatTime(feeding.fedAt);
  const name = document.createElement('p');
  name.className = 'feeding-state__name';
  name.textContent = feeding.employeeName;
  feedingState.append(label, time, name);
}

function renderState(state) {
  currentDateElement.dateTime = state.date;
  currentDateElement.textContent = formatDate(state.date);
  slotsElement.replaceChildren(...state.slots.map(createSlot));
  renderFeeding(state.lastFeeding);
}

async function loadState() {
  const state = await request('/api/state');
  renderState(state);
}

feedingForm.addEventListener('submit', async event => {
  event.preventDefault();
  const input = feedingForm.elements.employeeName;
  const button = feedingForm.querySelector('button');
  input.disabled = true;
  button.disabled = true;
  try {
    const feeding = await postJson('/api/feedings', { employeeName: input.value });
    renderFeeding(feeding);
    feedingForm.reset();
    showMessage(feedingMessage, 'Кормление отмечено.', 'success');
  } catch (error) {
    showMessage(feedingMessage, error.message, 'error');
  } finally {
    input.disabled = false;
    button.disabled = false;
  }
});

loadState().catch(error => {
  slotsElement.replaceChildren();
  showMessage(bookingMessage, error.message, 'error');
});
