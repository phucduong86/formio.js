import Promise from 'native-promise-only';
import _ from 'lodash';

import Webform from './Webform';
import Formio from './Formio';
import { checkCondition } from './utils/utils';

export default class Wizard extends Webform {
  /**
   * Constructor for wizard based forms
   * @param element Dom element to place this wizard.
   * @param {Object} options Options object, supported options are:
   *    - breadcrumbSettings.clickable: true (default) determines if the breadcrumb bar is clickable or not
   *    - buttonSettings.show*(Previous, Next, Cancel): true (default) determines if the button is shown or not
   */
  constructor(element, options) {
    super(element, options);
    this.panels = [];
    this.pages = [];
    this.globalComponents = [];
    this.page = 0;
    this.history = [];
  }

  init() {
    // Check for and initlize button settings object
    this.options.buttonSettings = _.defaults(this.options.buttonSettings, {
      showPrevious: true,
      showNext: true,
      showCancel: !this.options.readOnly
    });

    this.options.breadcrumbSettings = _.defaults(this.options.breadcrumbSettings, {
      clickable: true
    });

    this.currentPage = 0;
    return super.init();
  }

  get wizardKey() {
    return `wizard-${this.key}`;
  }

  get form() {
    return this.wizard;
  }

  set form(value) {
    super.form = value;
  }

  get buttons() {
    const buttons = {};
    ['cancel', 'previous', 'next', 'submit'].forEach((button) => {
      if (this.hasButton(button)) {
        buttons[button] = true;
      }
    });
    return buttons;
  }

  render() {
    return this.renderTemplate('wizard', {
      wizardKey: this.wizardKey,
      panels: this.panels,
      buttons: this.buttons,
      currentPage: this.currentPage,
      components: this.renderComponents([...this.globalComponents, ...this.pages[this.currentPage]]),
    });
  }

  attach(element) {
    this.element = element;
    this.loadRefs(element, {
      [this.wizardKey]: 'single',
      [`${this.wizardKey}-cancel`]: 'single',
      [`${this.wizardKey}-previous`]: 'single',
      [`${this.wizardKey}-next`]: 'single',
      [`${this.wizardKey}-submit`]: 'single',
      [`${this.wizardKey}-link`]: 'multiple',
    });

    this.attachComponents(this.refs[this.wizardKey], [...this.globalComponents, ...this.pages[this.currentPage]]);

    [
      { name: 'cancel',    method: 'cancel' },
      { name: 'previous',  method: 'prevPage' },
      { name: 'next',      method: 'nextPage' },
      { name: 'submit',    method: 'submit' }
    ].forEach((button) => {
      const buttonElement = this.refs[`${this.wizardKey}-${button.name}`];
      if (!buttonElement) {
        return;
      }
      this.addEventListener(buttonElement, 'click', (event) => {
        event.preventDefault();

        // Disable the button until done.
        buttonElement.setAttribute('disabled', 'disabled');
        this.setLoading(buttonElement, true);

        // Call the button method, then re-enable the button.
        this[button.method]().then(() => {
          buttonElement.removeAttribute('disabled');
          this.setLoading(buttonElement, false);
        }).catch(() => {
          buttonElement.removeAttribute('disabled');
          this.setLoading(buttonElement, false);
        });
      });
    });

    this.refs[`${this.wizardKey}-link`].forEach((link, index) => {
      this.addEventListener(link, 'click', () => {
        this.setPage(index);
      });
    });
  }

  addComponents() {
    this.pages = [];
    this.panels = [];
    _.each(this.wizard.components, (item) => {
      const pageOptions = _.clone(this.options);
      if (item.type === 'panel') {
        if (checkCondition(item, this.data, this.data, this.wizard, this)) {
          this.panels.push(item);
          const page = [];
          _.each(item.components, (comp) => {
            const component = this.createComponent(comp, pageOptions);
            component.page = this.currentPage;
            page.push(component);
          });
          this.pages.push(page);
        }
      }
      else if (item.type === 'hidden') {
        const component = this.createComponent(item, pageOptions);
        this.globalComponents.push(component);
      }
    });
  }

  setPage(num) {
    if (num === this.currentPage) {
      return;
    }
    if (!this.wizard.full && num >= 0 && num < this.pages.length) {
      this.currentPage = num;
      this.redraw();
      return Promise.resolve();
    }
    else if (this.wizard.full) {
      this.redraw();
      return Promise.resolve();
    }
    return Promise.reject('Page not found');
  }

  getNextPage(data, currentPage) {
    const form = this.pages[currentPage];
    // Check conditional nextPage
    if (form) {
      const page = ++currentPage;
      if (form.nextPage) {
        const next = this.evaluate(form.nextPage, {
          next: page,
          data,
          page,
          form
        }, 'next');
        if (next === null) {
          return null;
        }

        const pageNum = parseInt(next, 10);
        if (!isNaN(parseInt(pageNum, 10)) && isFinite(pageNum)) {
          return pageNum;
        }

        return this.getPageIndexByKey(next);
      }

      return page;
    }

    return null;
  }

  getPreviousPage() {
    const prev = this.history.pop();
    if (typeof prev !== 'undefined') {
      return prev;
    }

    return this.currentPage - 1;
  }

  nextPage() {
    // Read-only forms should not worry about validation before going to next page, nor should they submit.
    if (this.options.readOnly) {
      this.history.push(this.currentPage);
      return this.setPage(this.getNextPage(this.submission.data, this.currentPage)).then(() => {
        this.emit('nextPage', { page: this.currentPage, submission: this.submission });
      });
    }

    // Validate the form builed, before go to the next page
    if (this.checkPageValidity(this.submission.data, true)) {
      this.checkData(this.submission.data, {
        noValidate: true
      });
      return this.beforeNext().then(() => {
        this.history.push(this.currentPage);
        return this.setPage(this.getNextPage(this.submission.data, this.currentPage)).then(() => {
          this.emit('nextPage', { page: this.currentPage, submission: this.submission });
        });
      });
    }
    else {
      return Promise.reject(this.showErrors(null, true));
    }
  }

  prevPage() {
    const prevPage = this.getPreviousPage();
    return this.setPage(prevPage).then(() => {
      this.emit('prevPage', { page: this.currentPage, submission: this.submission });
    });
  }

  cancel(noconfirm) {
    if (super.cancel(noconfirm)) {
      this.history = [];
      return this.setPage(0);
    }
    else {
      return this.setPage();
    }
  }

  getPageIndexByKey(key) {
    let pageIndex = 0;
    _.each(this.panels, (_page, index) => {
      if (_page.key === key) {
        pageIndex = index;
        return false;
      }
    });
    return pageIndex;
  }

  checkPageValidity(data, dirty, page) {
    page = page || this.currentPage;

    let check = true;
    this.pages[page].forEach((comp) => {
      check &= comp.checkValidity(data, dirty);
    });
    return check;
  }

  get schema() {
    return this.wizard;
  }

  setForm(form) {
    if (!form) {
      return;
    }
    this.wizard = form;
    return this.init().then(() => {
      this.emit('formLoad', form);
      return form;
    });
  }

  hasButton(name, nextPage) {
    if (name === 'previous') {
      return (this.currentPage > 0) && this.options.buttonSettings.showPrevious;
    }
    nextPage = (nextPage === undefined) ? this.getNextPage(this.submission.data, this.currentPage) : nextPage;
    if (name === 'next') {
      return (nextPage !== null) && (nextPage < this.pages.length) && this.options.buttonSettings.showNext;
    }
    if (name === 'cancel') {
      return this.options.buttonSettings.showCancel;
    }
    if (name === 'submit') {
      return !this.options.readOnly && ((nextPage === null) || (this.currentPage === (this.pages.length - 1)));
    }
    return true;
  }

  pageId(page) {
    if (page.key) {
      return page.key;
    }
    else if (
      page.components &&
      page.components.length > 0
    ) {
      return this.pageId(page.components[0]);
    }
    else {
      return page.title;
    }
  }

  calculateVisiblePanels() {
    const visible = [];
    _.each(this.wizard.components, (component) => {
      if (component.type === 'panel') {
        // Ensure that this page can be seen.
        if (checkCondition(component, this.data, this.data, this.wizard, this)) {
          visible.push(component);
        }
      }
    });
    return visible;
  }

  onChange(flags, changed) {
    super.onChange(flags, changed);

    // Only rebuild if there is a page visibility change.
    const panels = this.calculateVisiblePanels();
    if (!_.isEqual(panels, this.panels)) {
      // If visible panels changes we need to completely rebuild to add new pages.
      this.rebuild();
    }
  }

  rebuild() {
    this.destroyComponents();
    this.addComponents();
    this.redraw();
  }
}

Wizard.setBaseUrl = Formio.setBaseUrl;
Wizard.setApiUrl = Formio.setApiUrl;
Wizard.setAppUrl = Formio.setAppUrl;
